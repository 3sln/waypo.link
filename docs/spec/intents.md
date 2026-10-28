# Intent links, intent kinds and handlers — normative draft

> **Pending [extensions revision 3](extensions.md) (draft, unsigned, 2026-10-27).** Where this document relies on the `intents.v1` and `intent-links.v1` features and other feature identifiers, extensions revision 3.2 and protocol §2–§4 govern instead. Change request CR-X3-10, [extensions Appendix A](extensions.md#appendix-a-migration-and-impact-change-requests-not-applied).

Status: **design candidate, 2026-10-22, revision 3.** Revision 3 records decisions that are Provisional (coordinator), not signed off by the user (the user delegated them); implementation proceeds on them, and they stay revisable: the fragment placement is required for capability kinds (§3.4, §9.3); signed intents are not part of version 1 (§3.3); and link hosts follow the handle-entry rules of §10. Organization-installed handlers stay provider policy (§6); 3sln.me's choice is in the design §6.7. Revision 2 (review round 1 applied; see the design's "Review round 1"). Unsigned v1 parsing, kind validation/projection, handler/default routing and owner controls are implemented locally (`packages/intents/`, `packages/runtime/routes/intents.mjs`), behind default-off `INTENT_LINKS_ENABLED` and, for app handlers, `INTENT_APP_HANDLERS_ENABLED`. Signed attribution remains outside v1. Not signed off, not published and not production-verified. Rationale, the 3sln.me routing and consent design, migration, threat model, slices and tests: [intent links design](../architecture/intent-links.md). Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. §14 lists the core amendments this draft needs; they are **proposed and unsigned**.

Protocol/security/interop sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol §2](protocol.md#2-discovery-and-login), [links §6.4](links.md#64-contact-intents-and-link-previews), [artefacts](artefacts.md), [integrations §2](integrations.md#2-integration-manifest), [incremental authorization §8–§9](incremental-authorization.md#8-describable-effects-and-risk-interop) and [identity portability](identity-portability.md). It generalizes the two contact intents of links §6.4 and the `intents.v1` handoff into an extensible mechanism. It defines the link format, the intent-kind artefact, handler declarations, the provider's processing obligations and the handoff to a handler. Chooser layout, wording, default policies beyond the obligations below, and every other presentation choice are provider policy.

## 1. Model

An **intent** asks "do this kind of thing with this data", for example "message this contact" or "open this conversation". It names its kind and carries data. It names no application.

An **intent link** is any URL that carries an intent in a `bintent` parameter. Whoever opens it is the **viewer**. The viewer's own provider (the **handling provider**) routes the intent to an application the viewer chose, after the viewer agrees. Because the link names no application, it keeps working when the minter or the viewer changes applications. Because it can be hosted on the minter's provider, it keeps working across provider moves through [identity portability](identity-portability.md).

An intent grants nothing. It is untrusted input to the handling provider and to the handler. Every effect happens only after the viewer confirms it in the handler.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Intent kind | A public artefact of kind `intent` (§4) that defines one purpose, a data schema and a disclosure. |
| Minter | Whoever created the link. Only a signed intent (§3.3) names a minter, and only then may it be shown. |
| Link host | The origin serving the URL that carries `bintent`. Any origin may be one. |
| Handling provider | The viewer's provider, which declares `intent-links.v1` (§12) and routes the intent. |
| Handler | An application whose integration manifest declares the kind (§5), or a provider built-in that does. |
| Handoff | The navigation from the handling provider to the handler's route (§8). |
| Handler default | A viewer's remembered choice of one handler for one kind line (§7.3). |

## 3. The intent and its encodings

### 3.1 Intent object

The intent is a JSON object with exactly these members:

| Member | Required | Definition |
| --- | --- | --- |
| `bintent` | yes | The integer `1`. The envelope version and magic member. |
| `kind` | yes | An artefact reference ([artefacts §5](artefacts.md#5-references)): `{"artefact": <line URL>, "version": <integer>, "digest": <version digest>}`. The line's kind MUST be `intent`. |
| `data` | yes | An object valid under the kind's data schema at that version (§4.2). |
| `iat` | signed only | Unix seconds. |
| `exp` | no | Unix seconds, after `iat` when both are present. An expired intent is refused. |
| `minter` | signed only | `{"iss","sub"}` of the identity that signed it (§3.3). It MUST be absent from an unsigned intent. |

The object is strict UTF-8 I-JSON under the rules of [links §3.1](links.md#31-jws-profile-shared-with-bindle_data) and [artefacts §3](artefacts.md#3-strict-parsing-and-canonical-form) rules 1–6: no duplicate members at any depth, no unknown members, numbers only as plain decimal safe integers (no fraction, exponent or `-0`), no unpaired surrogates or noncharacters, no Unicode normalization, nesting at most 8 levels. A reference with `version` and `digest` is mandatory: an intent never means "whatever the kind's URL serves now" (artefacts §5 rule 3).

### 3.2 Unsigned form

The `bintent` value is the canonical unpadded base64url encoding of the **canonical form** (artefacts §3, RFC 8785 under its integer and string rules) of the object. Decoding and re-encoding MUST give the same value, and a decoded text that is not the canonical form of its own parsed value is malformed. One intent therefore has exactly one unsigned encoding.

An unsigned intent has no attributed minter. Anyone can create one, so a handling provider and a handler MUST present it as coming from an unknown sender.

### 3.3 Signed form

**Version 1 status** (revision 3, Provisional (coordinator), not signed off by the user): signed intents are specified here for forward compatibility but are not part of version 1. A version 1 provider MAY ignore the signature and process a signed intent as an unsigned one with no attribution; it MUST NOT show a minter it has not verified under this section.

The `bintent` value is a compact JWS under the links §3.1 profile, with protected header exactly `{"alg":"ES256","kid":<kid>,"typ":"bindle-intent+jwt"}` and the intent object as payload, including `iat` and `minter`.

`kid` is a certification key (`use:"cert"`, [organizations §3a.3](organizations.md#3a3-identity-document)) of the identity named by `minter`, never its identity signing key. Every recovery file contains the signing key, so a signature by it could be forged by any holder of an old file (organizations review R4-H1, R4-L2), while certification keys are provider-held. A verifier resolves the key under the `directory.v1` profile ([organizations §3a.5](organizations.md#3a5-verifying-a-signature-from-an-unknown-provider)) and maps the identity to its origin principal through any successor chain ([identity portability §8](identity-portability.md#8-verifier-rules)). It accepts only a certification key that the identity document at the minter's **current** issuer lists as `active`, and `minter.iss` MUST be that current issuer. A `retired` or `revoked` key, or a `minter.iss` that is an earlier host of a moved identity (identity portability §8.2), gives no attribution. `iat` is the signer's own claim, so a retired key or a former host's key could otherwise sign new intents with a backdated `iat`; this rule matches organizations §3a.3, where certificates verify only against an `active` certification key and certification keys never cross a move. A signature shows that the minter's provider signed this intent for that identity. It confers no authority.

A value containing `.` is the signed form; any other is the unsigned form. A signature that does not verify for any reason (a bad signature, an unknown or revoked key, a minter that no longer resolves) gives no attribution: the intent is processed as unsigned, without its `minter`, and the provider says that a signature on the link could not be checked. It never shows the unverified minter. This is no downgrade, because anyone can strip a signature to make an unsigned intent. Attribution on a long-lived link therefore lasts only as long as the minter's provider keeps the key `active`, and ends at a key rotation or a move of the minter's identity.

### 3.4 Placement in a URL

An intent link is an absolute HTTPS URL that carries exactly one `bintent` value in one of two places:

- **Query** (canonical): a query component named exactly `bintent` (lowercase, unencoded) with `=` and the value as raw bytes, parsed with the raw-query parser of [links §2](links.md#2-recognizing-and-parsing-link-parameters). Percent-encoding, `+`, padding and whitespace in the value are rejected, not decoded.
- **Fragment**: the fragment is exactly `bintent=<value>`.

A URL with `bintent` in both places, with `bintent` more than once, or with any `bindle_*` parameter or legacy `sig` marker alongside `bintent`, is malformed.

**Capability kinds use the fragment** (revision 3, Provisional (coordinator), not signed off by the user). An intent whose kind has `capability: true` MUST be placed in the fragment. Minters MUST NOT produce the query placement for one. A handling provider that finds a capability kind in the query placement refuses it with `intent_malformed` once the kind is resolved (§4.5), without handing off, and applies §9.3 redaction to the request it already received. The scheme form (§10) is unaffected. A contact link stays a link. An intent that concerns one carries it in `data`.

The scheme form `web+bindle://intent?bintent=<value>` carries the same value for platform protocol handlers (§10, links §6.4). A provider receiving it through a registered handler URL (where the platform substitutes the whole scheme URL, percent-encoded, for `%s`) percent-decodes the substituted text **exactly once**. The result MUST be exactly `web+bindle://intent?bintent=<value>`: lowercase scheme and host, no userinfo, port, path, other query component or fragment, and a value that meets the raw-value rules above. Anything else is malformed; nothing is decoded a second time.

Unrelated query components are ignored and never reflected, as in links §2 rule 7.

### 3.5 Size bounds

- The decoded unsigned intent object is at most 4,608 bytes, and its `data` member at most 4,480 bytes when serialized.
- A signed intent's JWS payload is at most 5,120 bytes (the unsigned bound plus `iat`, `exp` and `minter`), and `kid` at most 200 characters as in links §3.1.
- The `bintent` value is at most 6,400 characters unsigned and 7,168 characters signed.
- A complete intent link is at most 8,192 characters.

These admit, in `data`, one contact link of at most 4,352 characters: a 4,096-character `bindle_meta` with an origin and path of at most 243 characters. Links §2 rule 5 allows longer contact links (a request target of up to 8,192 characters, and legacy `sig` links up to 18,000); those cannot be carried, and a minter MUST refuse to mint rather than truncate.

A kind MAY set a lower `max_bytes` for `data` (§4.1). Bounds are checked before any decoding work, fetch or signature verification.

## 4. Intent kinds

### 4.1 Body

An intent kind is an artefact line of kind `intent` under [artefacts §2](artefacts.md#2-the-envelope). Its body has exactly these members:

| Member | Required | Definition |
| --- | --- | --- |
| `id` | yes | The line URL. |
| `title` | yes | A map from BCP 47 tag to plain text of at most 80 code points: at most 8 tags, including `en`. Example: "Message a contact". |
| `summary` | yes | The same kind of map, at most 280 code points per entry. Says, in the second person, what a handler does with this intent after the viewer confirms ("Opens a message to this person in your messaging app"). |
| `publisher` | yes | An HTTPS origin. It MUST equal the origin of `id`; a body where it does not is invalid. Attribution always uses the host of `id` (§7.1), never a self-asserted origin, as in [extensions](extensions.md) for slots. |
| `effect` | yes | The most a handler may do after the viewer confirms: `view` (shows something), `save` (stores something among the viewer's data), `join` (makes the viewer a participant in something shared) or `send` (sends or publishes something as the viewer). |
| `data` | yes | The data schema (§4.2). |
| `disclosure` | yes | `{"categories": [...], "fields": {...}}` (§4.3). |
| `capability` | yes | `true` when some data member is a bearer capability (for example a contact link). It MUST be `true` when any field has `format: contact-link`; a body with such a field and `false` is invalid. Capability intents get the handling of §9.3. |
| `max_bytes` | no | An integer from 64 to 4,480: a lower limit than §3.5 on serialized `data`. |
| `supersedes` | no | A line URL. A hint only, as in artefacts §9.1 `successor`. |

Display strings follow artefacts §3 rule 7. Every display string is untrusted publisher text and is attributed to the host of `id`. Only a provider's own review may mark it as reviewed (incremental authorization §8).

### 4.2 Data schema

`data` is a declarative schema, never general JSON Schema: `{"type":"object","properties":{<name>: <field>},"required":[<names>]}`, with at most 16 properties. Names match `^[a-z][a-z0-9_]{0,31}$`. `required` is a unique, ascending subset of the property names. Unknown members are invalid. A field is exactly one of:

| Field | Members |
| --- | --- |
| String | `{"type":"string","maxLength":n}` with n from 1 to 4,352 Unicode code points, and optionally `format`: `https-url` (an absolute URL with scheme `https`, no userinfo and no fragment, equal to its own WHATWG serialization), `uuid` (lowercase 8-4-4-4-12 hexadecimal), `handle` (the full `local@host` form of [protocol §2](protocol.md#2-discovery-and-login), ASCII lowercase host), or `contact-link` (a canonical contact link as defined for `contact-url` in links §6.4). |
| Integer | `{"type":"integer","minimum":a,"maximum":b}` with safe integers a ≤ b. |
| Boolean | `{"type":"boolean"}` |
| Enum | `{"type":"enum","values":[...]}`: 1–64 unique strings of at most 64 code points. |
| Principal | `{"type":"principal"}`: an object with exactly `iss` (an HTTPS origin) and `sub` (a UUID). It is always an unverified claim. |

Data members not defined by the schema at the referenced version are invalid. A string that fails its `format` is invalid. Lengths are counted in code points after JSON unescaping. Strings are compared as written, never normalized (artefacts §3 rule 5). Display-rule strings (`display: value`) MUST additionally meet artefacts §3 rule 7; a value that does not is invalid, not stripped, so every implementation reaches the same verdict.

### 4.3 Disclosure

- `categories`: the [incremental authorization §8.3](incremental-authorization.md#83-sensitivity-categories) categories that any link of this kind can involve. A missing category never lowers risk, and unknown values are ignored for display but never lower risk.
- `fields`: exactly one entry per data property: `{"title": <map as for title>, "categories": [...], "display": "value"|"origin"|"presence"}`.
  - `value`: the provider may show the value. Allowed only for enum, boolean, integer and principal fields, and for strings with `maxLength` at most 120 and no `format` other than `uuid` or `handle`. A shown string is labelled as text from the link and quoted. A principal is shown as its `iss` host, plus a handle only when the provider already holds a verified binding for that principal; showing it never triggers a fetch, and it is always labelled as the link's claim.
  - `origin`: shows only the origin of an `https-url` or `contact-link` value.
  - `presence`: shows only that the member is present.
  - A field that carries a capability MUST use `origin` or `presence`. Every `contact-link` field carries one.

### 4.4 Growth points

This document registers the kind `intent` with artefacts §6.3:

| Pattern | Operation | Constraint |
| --- | --- | --- |
| `/data/properties` | add-member | Not added to `required`. The same version adds its `/disclosure/fields` entry. |
| `/disclosure/fields` | add-member | Only for a property added in the same version. |
| `/title`, `/summary`, `/disclosure/fields/*/title` | add-member | New BCP 47 tags only. |
| `/data/properties/*/values` | append | Only for an enum field whose version-*N* definition had `"extensible": true`. Handlers then MUST accept unknown values. |

Every other path is frozen, including `effect`, `capability`, `max_bytes`, `/disclosure/categories`, existing fields and existing `required`. Because `capability` is frozen, a version that adds a `contact-link` field to a line with `capability: false` is invalid. A new member with categories outside a consent's pinned version is a widening for that consent (§7.2).

### 4.5 Kind processing

A handling provider resolves the reference under [artefacts §7](artefacts.md#7-validation), only after viewer authentication (§6): from its store if it holds the digest, otherwise by fetching under artefacts §8.3, which never follows a URL found in an intent other than the kind's own line URL. A reference it cannot verify fails closed (`intent_kind_unavailable` when retryable, otherwise `intent_kind_invalid`). A version at or above an accepted retraction's `from` is refused for new handling (`intent_kind_retracted`). Existing handler defaults are not deleted by a retraction, but are not used for that version.

Providers SHOULD hold the kinds this specification registers (§11) in their store from installation, so that links of those kinds do not depend on the publisher staying reachable.

A fetch tells the kind's origin that someone at this provider opened a link of that line at that time, and a publisher can mint one line URL per recipient to turn this into a read receipt. A provider therefore SHOULD resolve from its store or a mirror (artefacts §8.4) where it can, MUST budget fetches of unknown lines per account and per origin, and MAY ask the viewer before fetching a line from an origin it has not fetched from before.

## 5. Handler declarations

An application declares the kinds it handles in the `intents` member of its integration manifest ([integrations §2.1](integrations.md#21-location-binding-and-client-type)): an array of at most 16 entries, each exactly:

| Member | Definition |
| --- | --- |
| `kind` | The intent kind's line URL. |
| `version`, `digest` | The highest version of that line the handler implements, with its version digest. |
| `route` | An HTTPS URL on the `client_id` origin, sharing its path prefix (integrations §2.1), with no query or fragment. The handoff target. |

Rules:

- `intents` grants nothing and needs no confidential client. A public client may declare it.
- Entries with duplicate `kind` invalidate every entry for that kind. Invalid entries are ignored.
- **Change handling** (integrations §2.3): adding, removing or changing an entry, or moving `route` within the origin and path prefix, is adopted at the next refetch and audited, without owner review, because a declaration confers no authority and first use always asks the viewer (§7.1). Removing a kind clears the viewer's default for that handler and kind.
- **Built-in handlers.** A provider's built-in functions declare kinds the same way in provider-authored manifests, and get the same choice and consent treatment.
- **What a declaration proves.** The route is bound to the client's verified origin. Nothing else is verified: not the quality of the handler, nor that it implements the kind faithfully. A provider shows the verified origin as the handler's identity, and the client name only as unverified text unless its own review says otherwise ([protocol §2](protocol.md#2-discovery-and-login), `client-id-metadata.v1`).

**Candidates.** For a viewer's entity, the candidate handlers of an intent are the built-ins and the applications with a live connection for that entity whose pinned manifest declares the intent's kind line, minus the handlers excluded by the viewer (§7.4). How applications that the viewer has not connected are offered (for example a catalogue) is provider policy, and connecting one is an ordinary authorization.

**Versions.** A handler that declares version *N* receives intents of version *M* ≤ *N* unchanged. For *M* > *N*, the provider routes only when it has verified that the line is additive from *N* to *M* (artefacts §7.2). It then removes every data member not defined at version *N* and delivers the intent in the unsigned form, re-encoded with `kind` naming version *N* and its digest. The handler receives no minter attribution for such a projection.

## 6. Handling provider processing

A provider declaring `intent-links.v1` accepts intents at its `endpoint` (§12) by:

- `GET <endpoint>?bintent=<value>` or `GET <endpoint>#bintent=<value>` (its own links and the scheme handler);
- a top-level form `POST <endpoint>` with `application/x-www-form-urlencoded` and exactly one field `bintent` (handoff from other link hosts, §10).

It processes in this order and stops at the first failure:

| Step | Failure |
| --- | --- |
| 1. Bounds and encoding (§3.2–§3.5) | `intent_malformed` (400) |
| 2. Strict JSON and exact members (§3.1) | `intent_malformed` |
| 3. Viewer authentication and account choice | — (a sign-in or account page) |
| 4. Kind reference resolution (§4.5) | `intent_kind_unavailable` (503, retryable), `intent_kind_invalid` (400), `intent_kind_retracted` (410) |
| 5. Data against the schema at that version (§4.2) | `intent_malformed` |
| 6. `exp`, then signature and `minter` (§3.3) | `intent_expired` (410); a failed signature only removes attribution |
| 7. Candidates, consent and choice (§7) | `intent_no_handler` (a page, not an error status) |
| 8. Handoff (§8) | — |

Requirements:

- Steps 1–6 create no durable state and consume nothing. Steps 1–2 perform no fetch. Before step 3 completes, the response MUST NOT depend on whether the provider's store holds the kind or on any fetch result, so that an unauthenticated party can neither probe the shared store (which reveals what other users opened) nor use the provider to fetch arbitrary URLs. After step 3, the only fetches are the kind line and, for a signed intent, the minter's manifest, directory and identity document, all under the protocol §2 SSRF rules and per-account and per-origin budgets.
- The provider authenticates the viewer before showing anything derived from the kind or `data`. When several accounts are signed in, the viewer chooses one explicitly. Until authentication completes, the value is kept only in the page or in session-scoped browser storage, never in a URL the provider generates.
- **The viewer is a person.** An organization entity is never the viewer, since nothing logs in interactively as an organization ([organizations §3](organizations.md#3-organization-entities)). A handler that acts for an organization does so only through member context ([organizations §7](organizations.md#7-member-context-for-applications)), after the viewer's confirmation in the handler. Whether organization-installed apps are offered to members as candidates is provider policy. A provider that offers them SHOULD do so only after the viewer chose to act as that organization, never mixed into the person's own candidates, and MUST name the acting entity on the chooser (revision 3, Provisional (coordinator), not signed off by the user).
- **Cross-site POST.** It carries no provider cookies under SameSite rules, and the provider MUST NOT relax SameSite to make it do so (as links §9). The provider renders a page that re-establishes the session same-origin and continues with step 3.
- **Fragment GET.** For `GET <endpoint>#bintent=`, the provider's page reads the fragment, removes it with `history.replaceState` before loading anything else, and continues by a same-origin POST. That POST is processed like the cross-site POST: it only renders.
- **Retention.** The provider keeps the value and `data` only for the duration of one flow (at most one hour) and never in audit, analytics or consent records. Consent, default and exclusion records hold the kind line, version, handler and time only.
- The provider MUST NOT act on an intent itself, MUST NOT call a handler server-to-server, and MUST NOT send the intent anywhere except the route of the handler the viewer chose.
- Recording a consent, default or exclusion is a separate same-origin, CSRF-protected POST from a provider page served with `frame-ancestors 'none'`, with controls armed after a delay. GET and the cross-site POST only render, except for the direct handoff that §7.3 permits.
- Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and never vary on cookies. `bintent` values are redacted from access logs, traces, analytics and crash reports.

## 7. Consent, choice and memory

### 7.1 First use

Before an intent of a kind line reaches a handler for the first time for an entity, the viewer MUST explicitly agree on a provider page, choosing **"just this once"** or **"always use this app for this kind"**. The page MUST show:

1. the kind's `title` and `summary`, attributed to the host of the kind's line URL (never to `publisher`), and whether the provider has reviewed this kind. Unreviewed kind text is quoted, labelled as the publisher's description, and placed after the provider's own wording of the effect and risk; it never appears in the page heading as provider text. When the line's registrable domain equals a candidate handler's, the provider says the kind is described by that app's own site and SHOULD raise its risk presentation, as the consent experience does for self-published contracts;
2. the `effect`, and the risk derived from it and from the kind's and the present fields' categories, presented under the provider's risk scheme;
3. the data this link carries, per field, under its `display` rule; a capability field is never shown in full;
4. the handler's verified origin, and its name only as unverified text unless reviewed, and any app-removal pending for it ([app removal §6.4](app-removal.md#64-while-a-removal-is-pending));
5. that the handler will receive this data;
6. for a signed intent, the verified minter (handle and host); for an unsigned intent, that the sender is unknown;
7. the account the intent will be handed to, when the viewer has more than one.

Every host shown (kind line, handler, `origin`-display values, minter) is shown in ASCII (A-label) form whenever its Unicode form mixes scripts or contains characters the provider considers confusable, and SHOULD highlight the registrable domain.

### 7.2 Remembered consent

"Always" records, for the entity, a handler default for the kind line, pinned to the version and digest shown. A later intent of version *M* above the pinned version reuses it only if no data member added after the pinned version adds a category outside those shown at consent. Otherwise the provider asks again, showing the difference, and the old default stays until the viewer decides. "Just this once" records nothing.

### 7.3 Choosing among handlers and changing defaults

- With more than one candidate, the provider shows a chooser. A handler default, when present, is preselected; otherwise nothing is preselected. The order never depends on what a manifest claims about itself.
- With a valid handler default and no widening (§7.2), the provider MAY hand off without a page, **only** when the request that delivered the intent was a top-level navigation whose `Sec-Fetch-Site` is `none` or `same-origin`, or `cross-site` with `Sec-Fetch-User: ?1` (a navigation the viewer activated), and the account has not exceeded the provider's limit on direct handoffs in a short window. Otherwise, including a script-submitted cross-site POST, a request without fetch metadata and any framed or prefetch request, it shows a one-control interstitial naming the kind and the handler, armed after a delay. This stops any page from silently bouncing the viewer into their default handler with data of its choosing.
- A newly connected application that declares the kind never replaces an existing default. The provider MAY tell the viewer that another handler is available.
- The viewer can see, change and remove handler defaults at any time from the provider's interface. Removing a default does not re-deliver any earlier intent.
- A default is cleared when the handler's connection ends (including app removal) or an adopted manifest snapshot stops declaring the kind. A failed or invalid refetch keeps the last adopted snapshot and clears nothing. The next intent asks again.

### 7.4 Never asking again

The viewer MAY:

- **exclude a handler for a kind line**, so that it is no longer offered for that kind; or
- **ignore a kind line**, so that intents of that kind end at a neutral provider page with no handoff and an undo control.

These records follow incremental authorization §9.1–§9.3. "The handler" means its client id and every client id on the same verified registrable domain. Records are owner data, listed with their scope and date, removable at any time, exported with the account and deleted with it. A handler or minter can never observe them: no handoff, timing or response reveals an exclusion, and nothing is ever reported back to a minter.

## 8. Handoff to the handler

The handling provider navigates top-level, from a page with `Referrer-Policy: no-referrer`, to:

`<route>#bintent=<value>&bintent_iss=<percent-encoded handling provider issuer>`

- `<value>` is the received value, or the projection of §5 "Versions".
- The data goes in the fragment, so it reaches neither the handler's server logs nor a `Referer`. Nothing is added to the query.
- `bintent_iss` is a hint telling the handler which provider to sign in with. It is untrusted.

The provider's consent is a routing and disclosure control, **not a security boundary for the handler**: any page can navigate a browser, or a frame, to `<route>#bintent=…` directly. The handler MUST:

1. read the fragment and remove it from the address bar with `history.replaceState` before loading any third-party resource;
2. treat the intent as untrusted input, validate it against the kind version it names, and verify a signature itself if it relies on one;
3. **never perform a state-changing, sending, joining or disclosing action without an explicit confirmation by the viewer in its own interface**, whatever the kind's `effect`, and treat an intent identically whether or not a provider routed it;
4. serve the route and every confirmation with `frame-ancestors 'none'`, arm confirmation controls only after a delay, and name in the confirmation the identity it will act as (person, or organization through member context);
5. use `bintent_iss` only to choose among issuers the viewer already has a session or connection with at the handler, and otherwise ignore it: never start discovery or sign-in at an issuer named only by the hint;
6. verify any capability in `data` with its owner as that capability's specification requires (for a contact link, links §8), before presenting it as verified;
7. send the intent's data nowhere except where fulfilling it requires (for a contact link, its owner host).

## 9. Security requirements

### 9.1 No open redirects

- A link host never redirects to a URL taken from `data`, and a handling provider navigates only to a declared `route` of a candidate handler.
- Every navigation in this document is to an origin derived from discovery (a manifest), from a pinned integration manifest, or from the kind's own line URL. No navigation target comes from intent content.

### 9.2 Phishing

- Kind text is publisher text, frozen once published (artefacts §6.2), and attributed to its host. A provider SHOULD prefer its reviewed copy for kinds it has reviewed.
- An unsigned intent never carries attribution (§3.2). A signed intent shows the minter only as resolved through the directory.
- `display` rules keep long free text out of consent pages. A provider MUST render all values as plain text, never as links. Display values with bidirectional or other controls are invalid (§4.2), not stripped.
- Hosts are displayed under the A-label rule of §7.1. Unreviewed kind text never appears as provider or link-host text (§7.1, §10).

### 9.3 Capability intents

For a kind with `capability: true`:

- link hosts, handling providers and handlers apply the URL-secrecy rules of [contact endpoints](../../apps/parlay/docs/legacy/contact-tokens.md#url-secrecy-and-browser-handling), as links §8 does for `bindle_meta`: redaction from logs, `no-store`, `no-referrer`, no service-worker caching;
- minters MUST use the fragment placement, and the query placement is refused (§3.4; revision 3);
- link previews never show data, and show a kind title only under §10.

### 9.4 Replay and auto-execution

An intent is a reusable request, not a credential. Opening a link twice is the same as asking twice. Nothing in this document executes on GET, on prefetch, from a remembered choice or from a cross-site POST without a viewer action in the handler (§8 item 3). Direct handoff from a remembered choice is limited by §7.3. Capabilities carried in `data` keep their own replay, quota and expiry rules.

### 9.5 Malicious handlers and minters

A handler is only offered after the viewer connected it, and only receives intents after first-use consent. An exclusion or a disconnection removes it. A hostile minter can only produce links that the viewer must open, agree to and then confirm in a handler of the viewer's choice. Bounds (§3.5), schema validation (§4.2) and fetch budgets (§6) limit resource use.

## 10. Link hosts and tooling

Any origin MAY host intent links. A link host's page for a URL carrying `bintent`:

- MAY decode the intent without verifying it. It MAY show the kind's title in its page, quoted and attributed to the host of the line URL, after verifying the kind reference itself; in preview cards (Open Graph, oEmbed and similar), which unfurlers present as the link host's own words, it shows a kind title only for kinds it has reviewed, and otherwise a generic card. It resolves kinds for previews only from its store, never by a fetch an unfurler triggers. It MUST NOT show data values or a minter unless it verified them as a handling provider would;
- reads a fragment placement and removes it with `history.replaceState` before loading anything else, and applies §9.3 to capability kinds;
- offers the viewer a way to continue at their own provider: by handle, through discovery ([protocol §2](protocol.md#2-discovery-and-login)) and `intent-links.v1`, followed by a top-level form POST of the value to `endpoint` after telling the viewer that the link will be sent to that provider; or through the `web+bindle://intent?bintent=<value>` scheme form for a platform-registered handler. When it asks for a handle (revision 3, Provisional (coordinator), not signed off by the user):
  - it MUST collect only the handle, never a password, passkey assertion, one-time code or other credential;
  - it MUST show the destination provider's host prominently, under the A-label rule of §7.1 with the registrable domain highlighted, before anything is sent, and send only on a viewer action naming that host;
  - for a capability kind it MUST also say, on the same screen, that the link carries a capability that provider will receive, including when it offers a remembered provider;
- MAY remember the viewer's chosen provider in the viewer's browser only, and MAY then offer it as a single control ("Continue with alt.example") beside a different-provider control. It never submits to a remembered provider without a viewer action, so the provider receives a user-activated navigation (§7.3);
- never redirects automatically to a provider that the viewer has not chosen on that browser, and never on a discovery failure.

A host that is itself a provider declaring `intent-links.v1` processes intents for its own signed-in viewers as in §6.

**Tooling.** Any software MAY recognize a `bintent` value on any URL and send it to the viewer's handling provider directly, without loading the link host. An intent therefore keeps working when its link host is gone. Tooling treats decoded content as unverified, as links §5 requires.

A provider that registers a platform protocol handler for `web+bindle` SHOULD place the substituted value in the fragment of its handler URL where the platform allows it. Otherwise it applies §6's redaction to the query.

## 11. Registered kinds (candidates)

This specification will publish these lines. Their bodies are drafts in the [design](../architecture/intent-links.md#registered-kinds).

| Line | `effect` | `capability` | Data |
| --- | --- | --- | --- |
| `https://spec.bindle.example/intents/send-message/v1` | `send` | `true` | `contact` (required, `contact-link`, `origin`) |
| `https://spec.bindle.example/intents/add-contact/v1` | `save` | `true` | `contact` (required, `contact-link`, `origin`) |
| `https://spec.bindle.example/intents/open-conversation/v1` | `view` | `false` | `conversation` (required, `uuid`, `presence`), `creator` (required, principal, `value`), `profile` (required, `https-url`, `origin`) |

**Migration from links §6.4.** `web+bindle://send-message?contact-url=<link>` and `web+bindle://add-contact?contact-url=<link>` are equivalent to unsigned intents of the first two kinds with `data.contact` set to the decoded link. A handling provider that also declares `intents.v1` SHOULD keep accepting `bindle_intent` on its `login_endpoint` and process it as that equivalent intent under §6 and §7. New pages SHOULD use `intent-links.v1` when the viewer's provider declares it, and fall back to `intents.v1` otherwise. A legacy intent whose contact link exceeds the `contact-link` bound (§3.5; legacy `sig` links may reach 18,000 characters under links §10) cannot be re-encoded: the provider keeps processing it through its pre-existing `intents.v1` path to a built-in handler, after the same first-use consent, and never hands it to an app handler. Existing contact links, `bindle_intent` URLs and platform handler registrations that predate this feature MUST keep working until the provider's migration ends; they are converted, never refused.

## 12. Feature declaration

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `intent-links.v1` | `endpoint` (issuer origin) | The provider is a handling provider under §6–§8 and processes `intents` handler declarations (§5). Requires `artefact-versions.v1`. | Link hosts fall back to `intents.v1` for the legacy contact intents, or to the scheme form. |

`intents.v1` is deprecated by this feature and SHOULD be removed once link hosts no longer depend on it.

## 13. Conformance tests

- **Format:** both placements; both forms; noncanonical JSON (whitespace, member order, `\u` escapes of plain characters) refused; `1.0`, `1e0` and `-0`; protocol-handler substitution decoded exactly once, double-encoded values refused; a maximal contact link signed and unsigned within bounds and one character past them; duplicate, encoded or mixed-case names; `bintent` alongside `bindle_meta` or `sig`; padding, `+` and percent-encoding in values; noncanonical base64url; unknown and duplicate members at depth; `minter` in an unsigned intent; a reference without `version` or `digest`; every bound at and one past its limit, checked before fetching.
- **Signatures:** a valid certification-key signature; a signature by the identity signing key gives no attribution; a wrong `typ`; a retired certification key gives no attribution whatever its `iat`; a link signed before the minter's move gives no attribution after it, and a `minter.iss` naming the earlier host fails; a failed signature removes attribution and never shows the claimed minter.
- **Kinds:** every growth point accepting a valid addition and rejecting an invalid one; frozen `effect` and categories; a retracted version refused while older versions keep working; an unreachable publisher with and without a stored record; data members undefined at the referenced version refused; `display: value` on a capability field rejected; `publisher` not same-origin with `id` rejected; a `contact-link` field with `capability: false`, in version 1 or added later, rejected; a `value` string with a bidi control rejected.
- **Declarations:** duplicate kinds invalidating each other; a route off the origin or path prefix ignored; a kind removed from a manifest clearing the default; a sibling client on the same registrable domain sharing exclusions.
- **Processing:** no fetch and no store-dependent response before authentication; no state or side effect before step 7; direct handoff refused for a script-submitted cross-site POST and for a navigation without fetch metadata, and allowed for `Sec-Fetch-Site: none`; value and data absent from records after the flow; no navigation target from data; consent and defaults recorded only by same-origin CSRF-protected POST; account choice with several sessions; `no-store`, `no-referrer` and log redaction.
- **Link hosts (revision 3):** the handle step collects no credential; nothing is sent before the destination host is shown and the viewer acts; a capability kind shows its disclosure on the first and on the remembered-provider path; a query-placed capability intent is refused with `intent_malformed` and no handoff.
- **Consent:** first use always asks; "once" records nothing; "always" pinned to a version; a widening version asks again and keeps the old default meanwhile; a new handler never replaces a default; exclusions and ignored kinds unobservable to handlers in body, status and timing.
- **Versions:** a handler declaring *N* receives an *M* > *N* intent projected and unsigned only after additivity is verified, and not at all otherwise.
- **Handoff:** data only in the fragment; the handler strips it; a handler test harness shows no action without a confirmation, refuses framing, and ignores a `bintent_iss` naming an issuer it has no session with.
- **Migration:** both legacy `web+bindle` intents and `bindle_intent` map to the registered kinds and go through first-use consent.

## 14. Core amendments — proposed (unsigned)

| ID | Document | Change |
| --- | --- | --- |
| AMD-I1 | protocol §2 | Add the `intent-links.v1` row (§12). Mark `intents.v1` deprecated in favour of it. |
| AMD-I2 | links §6.4 | The two contact intents become the registered kinds of §11. Define `web+bindle://intent?bintent=` as the scheme form. Other intent names stay reserved. `bindle_intent` is deprecated and handled as §11 describes. |
| AMD-I3 | artefacts §5, §6.3 | Register the `intent` kind and its growth table (§4.4). Clarify §5 rule 2: a reference object inside the JSON of a `bintent` value is a JSON reference, not a compact string form. |
| AMD-I4 | integrations §2.2, §2.3 | Add the `intents` member (§5) and its change-handling row. |
| AMD-I5 | links §7.2; organizations §3a.3 | Signature-domain row for `bindle-intent+jwt`, signed with a certification key (`use:"cert"`), separated by `typ`. Certification keys gain this second use; a certificate profile never accepts an intent JWS, and the reverse. |
| AMD-I6 | incremental authorization §9 | Cross-reference: handler exclusions and ignored kinds (§7.4) use the same app identity, listing, undo and unobservability rules. |
