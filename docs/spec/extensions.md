# Extensions and resource-field attributes — normative draft

> **Group:** Bindle core
>
> **Status:** draft, revision 3.3. Revision 3.2 is implemented locally behind default-off flags; revision 3.3 reconciles this text with that implementation (§10.3, provisional and unsigned). It supersedes revision 2 pending owner sign-off (two decisions, EXT3-25 and the setup exception, are owner-approved; so is keeping `embed_origin` with islands at its root; the rest are provisional).
>
> **Covers:** the extension mechanism: `{spec, options}` declarations, descriptors, resource-field attributes, provider features as fragment consumers, and the owner floor for suggestions.
>
> **Does not cover:** any particular extension (see `docs/spec/extensions/`); artefact versions and integrity ([artefacts](artefacts.md)); revision 2 slots ([superseded copy](superseded/extensions-rev2.md)).

Status: **draft, 2026-10-27, revision 3.3. Revision 3.2 is implemented locally behind default-off flags; revision 3.3 (§10.3) reconciles the text with that implementation and is provisional and unsigned.** Revision 3 **supersedes [revision 2](superseded/extensions-rev2.md) (slots, `extensions.v1`, AMD-X1), pending owner sign-off.** Revision 3.1 applies the revision 3 review fixes and cuts (§10.1). Revision 3.2 applies the revision 3.1 verification review and the owner's 2026-10-27 sign-offs and components direction (§10.2). The local code implements revision 3.2 (`packages/core/extensions.mjs` with the bundled descriptors, `packages/core/fragments.mjs`, `packages/app/domains/connections.mjs`, the `MANIFEST_DECLARATIONS` rows in `packages/runtime/federation.mjs`) behind `EXTENSIONS_ENABLED` (default off), with the divergences that §10.3 resolves. None of it is published, deployed or production-verified. A frozen copy of revision 2 is at [superseded/extensions-rev2.md](superseded/extensions-rev2.md) (commit 10852e1). Every decision here is provisional (coordinator, under the owner's delegation of direction), except EXT3-25 and EXT3-26, which the owner approved on 2026-10-27: EXT3-1 to EXT3-36 in §12, owner questions in §13. **The reading of "core" in §1 (EXT3-21) reinterprets an owner direction and needs owner sign-off before anything else here is relied on.** Inputs: owner directions in [DEVLOG](../../DEVLOG.md), 2026-10-27, "Owner direction: core scope, Parlay, signaling consumers", "Owner direction: manifest declarations (features, slots, ref)" and "Owner direction: remove slots; classifier scope; surfacing candidates", the owner direction on post-connection announcements recorded in the revision 3.1 DEVLOG entry, and "Owner sign-offs (EXT3-25, setup exception); components direction; contacts spike rev 2; address-routing reconciliation". Sign-off: reviewer ___ / date ___ / outcome ___.

This document extends [protocol §2–§4](protocol.md). It defines interoperability rules only, with no user interface beyond the disclosures it lists and no SDK behaviour. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. MUST, SHOULD and MAY express draft requirements. Appendix A lists the change requests that other specs and code need. None of them is applied by this draft, except the protocol §2–§4 edits and the link and wording fixes it names.

## 1. Model

- **Core** is the [conformance floor](protocol.md#2-discovery-and-login) plus the extension mechanism in this document. Anything optional to implement is an **extension**, whoever publishes it.
- An extension is identified by its **spec URL**, which is versioned (§2.2). A provider declares at most one version of an extension. Its **descriptor** (§2.3) is the published source of its options schema and user-facing text.
- A provider **declares** the extensions it implements in its manifest's `extensions` array, as `{spec, options}` (§2.1). A declaration is a claim about the provider. It confers no authority. Integration manifests carry no `extensions` member (§2.1).
- An extension MAY publish contracts, fragments, event types and at most one **provider feature** (§4.2). There are no slots.
- A fragment's resource fields MAY carry the core field attributes `selection`, `consumers` and `announce` ([protocol §3](protocol.md#3-fragments-and-preference-values)). Atomic fields carry none of them. Any fragment may use them, whether or not an extension publishes it.
- A field's **consumers** are applications (including integrations) and provider features. Both consume through ordinary grants.
- A field's **candidates** are defined in §5.1. Built-ins are provider-supplied resources in the owner's pool.

Which resources fill a field is the owner's preference value. Who may use them is a grant. Both are governed by protocol §3–§4. This document adds no authorization primitive.

> **Pending owner sign-off (EXT3-21): what "core" means.** The owner directed (2026-10-27) that "core Bindle is identity, preferences, intents, resources and hub connectivity; event buses stay in core", and also that "anything optional is by definition an extension, not core". This draft reconciles the two by reading the first as **Bindle-owned**: intents, intent links, integrations (hub connectivity), brokered resources, events, authorization entry, device authorization and the other areas in §2.8 are specified by Bindle, sit in the core document set, and are **Bindle-owned extensions** that a provider declares in `extensions`. The mandatory protocol stays the conformance floor, so a minimal self-hosted provider remains conformant and clients MUST fully support it. The alternatives are to make these areas mandatory for every provider (a much heavier floor), or to declare them through a separate core-owned container (which re-creates the `features` container the owner removed). This is a coordinator reading, not an owner decision.

## 2. Extension declarations

### 2.1 The `extensions` array

A [provider manifest](protocol.md#2-discovery-and-login) MAY contain `extensions`, an array of objects:

```json
"extensions": [
  {"spec": "https://spec.bindle.example/extensions/signaling/v1",
   "options": {"endpoint": "https://provider.example/bindle/signaling",
               "max_leg_certificate_seconds": 600, "profiles": ["data", "webrtc"]}},
  {"spec": "https://spec.bindle.example/extensions/artefact-versions/v1"}
]
```

| Member | Required | Meaning |
| --- | --- | --- |
| `spec` | yes | The extension's spec URL (§2.2). It is the extension's whole identity. |
| `options` | no | Object validated against the descriptor's options schema (§2.4). Absent means `{}`. |

Entries carry no local name, reference, digest, purpose text or role. User-facing text comes only from the descriptor (§2.3) and from fragment metadata.

**Integration manifests** carry no `extensions` member: no extension defines an integration-side role. Integration roles keep their dedicated `bindle_integration` members (`removal` in [app removal](extensions/app-removal.md), `intents` in [intents](extensions/intents.md)). An extension that later defines an integration-side role specifies its own member, named by its spec URL unless it is Bindle-owned, and its endpoints follow §2.4.

### 2.2 Spec URL and versions

A spec URL is an absolute HTTPS URL of at most 256 characters, with no userinfo, query or fragment, whose last path segment matches `^v[1-9][0-9]{0,2}$`. The URL without that segment is the extension's **line**, and the segment is its **version**.

- Each version is a distinct extension. Its descriptor is immutable (§7).
- A provider declares at most one version of a line. An incompatible change is a new version, and the provider declares the new spec URL **instead of** the old one. Entries for two or more versions of one line are all treated as absent (§2.5).
- Matching is by exact URL. A look-alike URL is a different extension.

### 2.3 Descriptor

The publisher publishes one descriptor per version, with the extension's spec, as JSON of at most 16 KiB:

```json
{
  "id": "https://spec.bindle.example/extensions/signaling/v1",
  "title": "Signaling",
  "description": "Direct connections between your devices and other people's, for the kinds you approve.",
  "document": "https://spec.bindle.example/extensions/signaling/v1/spec.html",
  "options": {
    "endpoint": {"title": "Session endpoint", "type": "url", "maxLength": 2048, "endpoint": "audience"},
    "max_leg_certificate_seconds": {"title": "Leg certificate lifetime", "type": "integer", "minimum": 120, "maximum": 900},
    "profiles": {"title": "Profiles", "type": "enum", "values": ["data", "webrtc"], "cardinality": {"min": 1, "max": 2}}
  }
}
```

| Member | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Equal to the spec URL. |
| `title`, `description` | yes | Untrusted plain text, at most 100 and 500 characters. This is the user-facing text for the extension and for its provider feature, if it defines one. It is always shown with the host of `id` (§8.2). |
| `document` | no | HTTPS URL of the human-readable spec. |
| `options` | yes | The options schema for provider declarations (§2.4). It may be `{}`. |

Unknown descriptor members make the descriptor invalid. A processor **implements** an extension by holding its descriptor together with an implementation of its spec, normally bundled. Processors never fetch a descriptor to process a declaration, and a declaration for an extension a processor does not implement is ignored (§2.5). Where a publisher serves descriptors is not normative.

### 2.4 Options

An options schema is an object of at most 32 option members. Each option member uses the field members of the [protocol §3 member table](protocol.md#3-fragments-and-preference-values) for atomic types (`title`, `description`, `type` other than `resource`, `cardinality`, length and range bounds, `values`), plus one extra member, `endpoint`, allowed only on a `url` option. Field attributes (`selection`, `consumers`, `announce`) are not allowed.

- **Values.** An option whose `cardinality.max` is 1 takes a single value of its type. Any other option takes an array of `min` to `max` values. Cardinality defaults to exactly one, so an option is required unless its `cardinality.min` is 0. An option MAY be absent only when its `min` is 0, and then has no value; the extension's spec states what absence means.
- **Endpoint options.** `endpoint` marks a URL the processor sends requests to, whatever the option's name (for example `directory_url`, `config_url`, `jwks_uri`). Its value is `"audience"` when the extension's spec says the URL receives access or refresh tokens, authorization codes, client assertions or other audience-bound signed requests, or secret material such as private keys (for example a portable identity package), and `"public"` otherwise (key sets, configuration documents, pages a user agent navigates to). The secret-material case is owner-approved 2026-10-28 (§10.3). Every endpoint option MUST be on the issuer origin. The one exception is an option that core names (§2.7).
- **Distinct audiences.** An audience endpoint MUST differ from every other audience endpoint in the manifest: the flat `authorization_request_endpoint`, `token_endpoint`, `rpc_endpoint`, `revocation_endpoint` and `device_authorization_endpoint`, and every audience option of an extension the processor implements. Public endpoints carry no audience and MAY share a URL, with each other or across extensions. For example, one JWKS document may serve both the brokered-resources and app-removal extensions.
- **Comparison** (rev 3.3, provisional). Audience endpoints, flat members included, are compared as the serialisation (`href`) of the [WHATWG URL](https://url.spec.whatwg.org/) parse of each value. Parsing lowercases the scheme and host, converts the host to its ASCII form, drops a default port, resolves dot segments and gives an empty path `/`, so `https://P.example:443` equals `https://p.example/`. Query strings are compared exactly. Nothing else is normalised: percent-encoding case, path case and a trailing slash on a nonempty path stay significant.
- **Violation.** An entry whose audience endpoint equals a flat audience endpoint is invalid. When audience options of two or more entries are equal, every one of those entries is invalid. An invalid entry is absent for that processor, so the suspension rules apply to any provider-feature grants that rely on it (§4.2).
- **Integration side.** An integration-side endpoint that a later extension defines MUST be on the integration's `client_id` origin and path prefix ([integrations §2.1](extensions/integrations.md#21-location-binding-and-client-type)). If it is an audience endpoint, it MUST differ from the integration's `events_endpoint`, `rpc_endpoint` and `discovery_endpoint`.
- A `url` option without `endpoint` is an opaque identifier, for example a contract URL. Processors never send requests to it, unless the extension's spec explicitly says so **and** the URL is on the declarer's origin. Matching it against a contract or artefact the processor already holds is not a request.
- Unknown option members are ignored. A known member that fails validation makes the entry absent for that processor. An `enum` value outside the descriptor's `values` is such a failure, so a descriptor's value set cannot grow under its spec URL (§7); an extension that expects more values publishes them all before its first descriptor is published, or uses a new spec URL.
- Options describe only the declaring provider, and are never merged with another party's.

### 2.5 Processing and bounds

The [protocol §2 processing rules](protocol.md#2-discovery-and-login) apply: I-JSON, the 64 KiB manifest bound, claims not proof, issuer isolation, session-only downgrade and the cache limits. In addition:

- A provider manifest holds at most 48 entries. Each entry is at most 4 KiB serialized.
- An entry with an invalid `spec` is ignored. An entry for an extension the processor does not implement is ignored.
- Two or more entries with the same `spec`, or for two or more versions of one line (§2.2), are all treated as absent.
- Unknown entry members are ignored. An invalid entry never invalidates the manifest.
- **Prerequisites.** There is no generic dependency member: an extension that depends on another says so in its own spec. A processor of the dependent extension checks only, without recursion, that exactly one entry with the prerequisite's exact `spec` is present in the same manifest, and it need not implement the prerequisite. If the check fails, the dependent extension is treated as absent.

### 2.6 What a declaration means

A provider declaration means the provider implements the extension, as configured by `options`, for its entities. Which built-in resources it supplies, and whether it offers the extension's provider feature, is defined by the extension's spec (§4.2, §5.2).

A declaration never makes a resource a candidate (§5.1), never replaces a grant request, and never assigns anything. An integration that wants to consume a field requests a grant (protocol §3). An integration that supplies resources does so through `resources` and discovery ([integrations §4](extensions/integrations.md#4-resource-discovery)).

### 2.7 Extensions cannot change core

An extension cannot alter discovery, issuer rules, consent, grants, tokens, RPC semantics, the fragment member table or the field attributes. It cannot require introspection: only contracts can mark that ([contracts](contracts.md#contract-method-metadata)). The only exceptions are those core names by spec URL:

- the Bindle-owned **brokered-resources** extension: integration-origin endpoints for consumer RPC and provider events ([protocol §4](protocol.md#4-grants-and-live-authorization), AMD-C8);
- the [component-origin envelope](auth.md#presentation-transports-and-key-binding), for the Bindle-owned **embedded-components** extension (`https://spec.bindle.example/extensions/embedded-components/v1`, placeholder; provisional answer to §13 Q5, CR-X3-16). Its `embed_origin` option is a public endpoint option that is exempt from the issuer-origin rule of §2.4, for this extension only. It may name a subdomain or an associated site the provider operates. It is authoritative because the issuer's own manifest declares it. The **component origin** is the origin of that declared option. The envelope's conditions (a fresh key proof, codes reaching the client only at its registered redirect origin, component credentials never accepted at core endpoints, no change to consent, grants or tokens) exist because components run framed inside other sites' pages under browser storage partitioning, not because the provider's ownership of the origin is in doubt. The extension's content is the [components profile](../profiles/components-v1.md), pending republication under the Bindle namespace, with these changes:
  - **Island location** (*owner-approved 2026-10-27*, DEVLOG "Owner direction: keep `embed_origin`; islands document at the origin root"): `embed_origin` stays, and the island document is `<embed_origin>/?client=<client_id>#<part>.v<n>`, at the origin root. Every other path on the embed origin is provider-private. Implemented locally (2026-10-28, CR-X3-16/35); provider-private sub-resources keep `/embed/...` paths.
  - **Options** (rev 3.3, provisional and unsigned): `embed_origin` (public, exempt as above), `protocol` (1–8 integers, 1–64), `parts`, optional `credential_binding` (enum, defined value `key-binding.v1`) and optional `manage_url` (public). Options are atomic (§2.4), so the profile's nested `parts` map becomes an `enum` array of `<name>/<version>` strings, currently `avatar/1`, `account-switcher/1`, `sign-in/1` and `request/1` (1–4 values).
  - **No FedCM in islands** (rev 3.3, provisional and unsigned): the per-part `fedcm` member is dropped, and islands never delegate to FedCM, so the component origin creates authorization entries only, never FedCM assertions. The fedcm extension is unaffected outside islands.
  - **No `theme_tokens`** (rev 3.3, provisional and unsigned): islands use provider defaults and the element sends no tokens.

### 2.8 What replaces `features` and `profiles`

Every former `features` key and `profiles` key becomes an extension declaration. Its former members become `options`, with unchanged names and rules. Every member that names a URL a processor sends requests to becomes an `endpoint` option, `audience` or `public` (§2.4), whatever its name. For example, organizations' `directory_url` is a public endpoint option. OAuth-registered flat members (`revocation_endpoint`, `dpop_signing_alg_values_supported`, `grant_types_supported`, `device_authorization_endpoint`, `token_endpoint_auth_methods_supported`) and `login_presentation` stay flat. Every row is Bindle-owned (§1, EXT3-21).

| Former identifier | Spec URL (placeholder) | Defining document |
| --- | --- | --- |
| `authorization-entry.v1` | `…/extensions/authorization-entry/v1` | protocol §2, auth, incremental authorization |
| `device-authorization.v1` | `…/extensions/device-authorization/v1` | device authorization |
| `integrations.v1` | `…/extensions/integrations/v1` | integrations |
| `brokered-resources.v1` | `…/extensions/brokered-resources/v1` (prerequisite: integrations) | integrations |
| `fedcm.v1` | `…/extensions/fedcm/v1` (prerequisite: authorization-entry) | auth |
| `intents.v1` | none: withdrawn (contacts and links spike CL-11, CR-P1; provisional) | former links §6.4 |
| `intent-links.v1` | `…/extensions/intent-links/v1` (prerequisite: artefact-versions) | intents |
| `client-id-metadata.v1` | `…/extensions/client-id-metadata/v1` | protocol §2 |
| `signaling.v1` | `…/extensions/signaling/v1` (prerequisites: directory, artefact-versions) | signaling |
| `rtc-signaling.v1` | none: superseded by signaling; the interim `…/extensions/rtc-signaling/v1` is retired (below) | rtc-signaling (superseded) |
| `directory.v1`, `organizations.v1`, `key-delegation.v1`, `relations.v1` | `…/extensions/<name>/v1` | organizations |
| `portability.v1` | `…/extensions/portability/v1` | identity portability |
| `events.v1` | `…/extensions/events/v1` | events |
| `app-removal.v1`, `subject-deleted.v1` | `…/extensions/<name>/v1` | app removal |
| `artefact-versions.v1`, `artefact-mirror.v1` | `…/extensions/<name>/v1` | artefacts |
| `link-response.v1` | none: withdrawn (contacts and links spike CL-3, CR-P1; provisional) | former links §9 |
| `extensions.v1` | none: the mechanism is core | this document |
| `profiles` key `https://3sln.me/artefacts/profiles/components/v1` | `…/extensions/embedded-components/v1` (provisional, §2.7, Q5) | components profile (with the §2.7 changes; republication pending) |

`…` is `https://spec.bindle.example`. Prerequisites stay in prose in each extension's spec and are checked as in §2.5.

**Endpoint kinds** (rev 3.3, provisional and unsigned). Protocol §2 classifies the endpoint options of the extensions in its table. For the others:

| Extension | Audience options | Public options | Optional (`min` 0) |
| --- | --- | --- | --- |
| directory | none | `directory_url` | none |
| relations | `accept_endpoint`, `join_endpoint`, `events_endpoint` | none | `events_endpoint` |
| portability | `move_endpoint`, `transfer_in_endpoint` | `attestation_jwks_uri` | all three |
| signaling | `endpoint` | none | none |
| intent-links | none | `endpoint` (top-level GET and form POST carrying only the unauthenticated intent value) | none |
| app-removal | `completion_endpoint` | `jwks_uri`, `return_uri` (a page a user agent navigates to) | `completion_endpoint` |
| embedded-components | none | `embed_origin` (exempt, §2.7), `manage_url` | `manage_url` |

**Interim RTC identity: retired** (2026-10-28, provisional and unsigned). Revision 3.3 allowed the legacy RTC code to declare an interim `…/extensions/rtc-signaling/v1` behind default-off flags until signaling Appendix C (EXT3-35). The signaling engine phase (Appendix C.5 steps 2 to 5) replaced that code locally on 2026-10-28, so the interim identity is withdrawn, not versioned; it was never published. The local code now declares `…/extensions/signaling/v1` with options `endpoint` (audience), `max_leg_certificate_seconds` (integer, 120–900) and `profiles` (one or both of `data` and `webrtc`), and prerequisites directory and artefact-versions ([signaling §3.1](extensions/signaling.md)), behind default-off flags and absent from any published manifest.

## 3. Selection

A resource field's `selection` is fixed by the fragment, because the policy is part of what the field means. The owner decides which resources fill the field and in what order. Consumers apply the policy mechanically.

The field value is an ordered list in owner order. Order is significant for `ordered`, and presentation only otherwise.

| Policy | Cardinality | Consumer behaviour |
| --- | --- | --- |
| `exclusive` | max 1 | Invoke the single resource. With none, the field is unfilled. |
| `ordered` | max 2–8 | Invoke the first available resource in owner order. Advance only under the pre-dispatch rule (§3.3). |

A field without `selection` states no policy. Consumers use its values as the fragment's description says, and get no failover guarantee. A consumer that cannot implement a field's policy MUST NOT request the field.

### 3.1 Availability and representation

A resource is **available** to a consumer only when all of these hold:

- it is in that consumer's current preferences projection with `status: "available"` ([integrations §5.1](extensions/integrations.md#51-preferences-projection), [contracts AMD-C3](contracts.md#preferences-v1));
- its credential is current;
- for a provider feature, the enablement is live and not suspended (§4.2).

The projection lists approved resources in owner order and omits unapproved ones, whose presence is signalled only by the field name in `requiresConsent`. An unapproved addition never withholds approved resources. A consumer MUST NOT invoke a resource obtained from any other source as if it filled the field. An empty `exclusive` field is represented by absence, and an empty `ordered` field by `[]`.

### 3.2 Operation snapshot

A consumer reads the value once per operation. Later additions and reorders apply to later operations. A removal stops dispatch to that resource for pending operations as soon as the consumer observes it. Every switch to a different resource uses a fresh `tx`, because journals are per resource server.

### 3.3 Failover for `ordered`

A consumer advances to the next resource only after a failure that proves no effect occurred:

- the resource was unavailable before dispatch (§3.1);
- the connection failed before any request bytes were sent;
- HTTP 401, 403, 404 or 429, or an error envelope `unsupported_contract`, `unsupported_method`, `forbidden`, `not_found`, `rate_limited` or `temporarily_unavailable` ([protocol §5](protocol.md#5-rpc-transport), AMD-C4).

These are claims by the resource. A field that needs at-most-once effects across resources MUST use `exclusive`.

After a timeout following the send, a 5xx, `indeterminate` or any other ambiguous outcome, the consumer MUST NOT invoke a different resource for that operation. It retries the same resource with the same `tx`, or reports the outcome as unknown. If a resource with an outstanding ambiguous outcome is removed or replaced, the consumer reports the outcome as unknown to the owner and never dispatches it elsewhere.

### 3.4 Policy is not authority

Selection never widens a grant. A consumer approved for resource A gains nothing when the owner adds B: B is omitted from its projection, and the field is in `requiresConsent`, until the owner approves that consumer for B.

When the owner adds or replaces a resource in a field that has consumers, the provider presents each affected consumer separately, with none preselected, and shows the current resource's origin beside the new one. Unchecked consumers stay unapproved for the new resource.

Any change that adds, replaces or reorders resources in a field consumed by an enabled provider feature, including filling the field when the feature is enabled (§4.2), requires recent owner authentication. It is never offered inside an authorization flow initiated by an application or integration. Removing a resource needs no re-authentication.

## 4. Consumers

`consumers` (default `["application"]`) says who may request a grant on a field. A provider MUST refuse a request from a consumer kind the field does not list.

### 4.1 Applications

An application consumes a field by requesting its fragment, pinned by `digest` (protocol §3, AMD-C2) or by a version reference ([artefacts §5](artefacts.md#5-references)) at a provider implementing the artefact-versions extension (§7), with explicit methods per field contract. Every consent, scoping and revocation rule applies.

### 4.2 Provider features

A **provider feature** is a provider-side function that an extension's spec defines. An extension defines at most one. A provider that wants several functions publishes several extensions. Whether a declaration offers the feature is defined by the extension's spec from its options.

**Identity.** A provider feature's client identity is the pair (issuer, extension spec URL). That pair is the client identity everywhere protocol §4–§5 and integrations use one: grant records, journals, brokered credentials (`client_id` = issuer, `bindle.feature` = the spec URL) and `tx` derivation. Two features never share a grant, a journal entry or a credential. On the wire the pair appears only as `client_id` = issuer and `bindle.feature` = spec URL; how a provider serialises it in its own records is local. User-facing text is the descriptor's title and description, always shown with the host of the spec URL.

A provider feature:

- exists only while the provider validly declares its extension;
- consumes fields only where `consumers` includes `provider`;
- requests grants in the ordinary request shape (fragment pinned as in §4.1, fields, per-contract methods), with the descriptor text as its purpose. It sends no `required`: there is no connection for a declined request to cancel, so a declined request simply leaves the feature not enabled;
- is enabled only by an explicit owner action in the provider's authenticated interface, always with recent owner authentication, whether or not a value changes (rev 3.3, provisional). That action is the consent for the request, with every protocol §3 disclosure. For an empty field, the owner may choose its value on the same screen under §5.3 (§3.4);
- has no authority beyond its grant: protocol §4's intersection rule applies, with its client identity;
- is listed among the field's consumers wherever the owner sees them.

For a brokered resource, the provider obtains credentials under [integrations §5.3](extensions/integrations.md#53-consumer-credentials) with `client_id` set to the issuer URL and `bindle.feature` set to the spec URL. `bindle.grant` identifies the enablement, and changes on every re-enable, value change or reapproval.

A provider feature's `tx` values are UUIDs. A feature that derives them deterministically uses UUIDv5 ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)) in the URL namespace (`6ba7b811-9dad-11d1-80b4-00c04fd430c8`), whose name is the UTF-8 encoding of `<spec URL>|<contract URL>|<entity>|<fingerprint>`: the four inputs joined by `|` (U+007C), with no other escaping (rev 3.3, provisional). `entity` is the entity's identifier as the provider records it, and `fingerprint` is the feature-defined operation fingerprint. The first three inputs MUST NOT contain `|`, so the join is unambiguous. Example: spec `https://provider.example/extensions/email-bridge/v1`, contract `https://spec.bindle.example/contracts/public-intake/v1`, entity `https://provider.example/entities/e_123` and fingerprint `fp-1` give `0483d642-1733-5755-aca1-fff45c002ab3`.

**Disabling, suspension and revocation.**

- **Disabling** by the owner revokes the feature's grants at once: new invocations stop and its brokered credentials are revoked.
- **Suspension.** When the provider's entry for the extension becomes absent or invalid (removed, duplicated, failing option validation, colliding on an audience endpoint (§2.4) or missing a prerequisite (§2.5)), or an options change withdraws the feature or something its grants rely on, the affected grants are **suspended** at once. A suspended feature makes no invocations, obtains no credentials and does not use outstanding ones. Its grant records and the field values are kept, and the owner sees the suspension. When the same spec URL is validly declared again and offers the feature, suspended grants resume, bound to the values and fragment pins they were approved under. A declaration of a different version of the line is a different extension and resumes nothing (§2.2).
- **Revocation after suspension.** Suspended grants are revoked, with their brokered credentials, when the owner disables the feature, or after 30 days of continuous suspension. Affected owners are notified on revocation ([integrations §7.1](extensions/integrations.md#71-operations)).
- **Blocking** an extension version (§7) revokes its feature's grants and credentials.
- Suspension and every narrowing take effect immediately. Nothing waits for review.

### 4.3 Outcomes from public facts only

A provider MAY report an optional fragment request as `unavailable` without presenting it (the per-fragment outcome of core amendment C5, [wire profile](federation-implementation.md)), but only when that follows from public facts: it blocks the fragment, or some requested resource field can be filled at this provider for no entity at all. That is, no field contract appears in the manifest `contracts` (§5.2), and the provider admits no brokered, adapter or contributed resource for those contracts. Otherwise the request is presented normally. The response MUST NOT reveal whether this owner has connections, candidates or values. Clients treat a missing status as `declined`.

## 5. Candidates and assignment

### 5.1 Candidates

A **candidate** for a resource field is one of the following whose contracts include every contract the field requires (AND, exact URLs):

1. **Built-in:** a resource the provider supplies in the owner's pool (§5.2). Its contracts are those the provider implements for it, which the manifest `contracts` lists.
2. **Adapter resource:** a resource the provider hosts on its adapter gateway for an upstream account the owner connected (for example the owner's own cloud drive). Its contracts are those the adapter implements. It is not a built-in and carries no built-in marker. It is shown as the upstream service and account, via the provider.
3. **Brokered offer or record:**
   - an **offer** is an active integration connection whose `resources.contracts`, validated and recorded at the connection, include the field's contracts, before any brokered record exists. Choosing an offer runs owner-initiated discovery ([integrations §4](extensions/integrations.md#4-resource-discovery)) and registers the item the owner selects;
   - a **record** is a registered brokered resource. Its contracts are the full validated claim recorded at registration (discovery claim intersected with the manifest list), as narrowed by revalidation. Narrowing to a field's contracts happens per grant, not per record, so one record can be a candidate for every field it satisfies (CR-X3-07).
4. **Contributed resource:** its contracts are those in its contribution record ([resource contributions](extensions/resource-contributions.md)).

Contracts of offers, records and contributed resources are claims by the supplying party, not proof of conformance, and are always shown as that party's claims (§8.1). Declarations, names, labels, purpose text and application input never create, exclude or rank candidates. A contract marked `x-bindle-brokerable: false` has only issuer-hosted candidates (kinds 1 and 2).

### 5.2 Built-ins

A built-in is a resource the provider supplies in the owner's pool, like the default storage resource. A provider MUST list in its manifest `contracts` every contract any of its built-ins implements. A built-in is a candidate like any other, gets no preference in order, prominence or default, and fills a field only when the owner assigns it. The one exception is the provider's own initial account setup ([protocol §3](protocol.md#3-fragments-and-preference-values), owner floor rule 3). Cost, data-processing location and, where relevant, model provenance are disclosed under protocol §3.

### 5.3 Assignment and disclosure

Assignment follows the [protocol §3 owner floor](protocol.md#3-fragments-and-preference-values). Before saving a value, the provider MUST disclose:

- the fragment title and the host of its `id` (the fragment `publisher` only when same-origin with `id`, and always as unverified);
- the selection policy in plain language;
- each resource's verified origin. For a brokered resource, that is the integration origin that receives invocations directly. Integration-supplied labels are always shown as that integration's text, next to its origin;
- a built-in marker that the provider renders outside every application- or integration-supplied text. A supplied label that claims to be built-in, or imitates the marker, is still shown only as the supplier's label next to its origin;
- every current consumer: each approved application by verified origin, and each enabled provider feature by its descriptor title with the host of its spec URL.

Replacing or reordering resources shows the affected consumers (§3.4).

## 6. Announcements (`announce`)

A resource field with `announce: true` lets the provider tell the owner, after the fact, that a newly available candidate can fill it. Fields without it are shown only passively, in the owner's settings and configuration views. This section is the Bindle floor. Everything it does not forbid is provider policy, within it.

1. **After, never during.** An announcement is made only after the owner action that produced the candidate has completed: an integration connection became active, or the owner registered or contributed a resource. Revalidation, change hints, a confirmed existence or a built-in becoming available are never triggers. An announcement never appears inside an authorization, connect, setup or consent flow, or on an application's pages.
2. **Scope.** Only fields of fragments the owner has already approved for a consumer that is still enabled: an application grant, or an enabled provider feature that is not suspended (§4.2). Never fields that only a provider feature the owner has not enabled, or that is suspended, would consume. This is an upper bound: announcing is optional, and a provider MAY announce for a subset of it. At minimum, a provider that announces at all covers the `announce` fields consumed by its enabled provider features (rev 3.3, provisional; this is what the local implementation computes).
3. **No self-announcement.** Only candidates supplied by a party other than the provider (brokered offers and records, contributed resources) are announced. The provider never announces its own built-ins or adapter resources, and never announces its provider features.
4. **Basis.** Computed locally by the provider from contracts already recorded: for an offer, the contracts recorded at the integration's connection; otherwise those of §5.1. The provider sends nothing to the integration to make an announcement, so nothing about one is observable to it.
5. **Wording.** Only provider-fixed templates and extension descriptor text (with the host of its spec URL). Consumers are named by verified origin, or by descriptor title and host. Fragment and field titles are never used. The candidate is named by its verified origin, with any supplied label shown as the supplier's text, and its contracts are labelled as the supplier's claims.
6. **At most once.** At most one announcement per (field, candidate supplier: the integration's client, or the contributed resource), unless the owner turns announcements back on for that field.
7. **No assignment.** Acting on an announcement opens the field's ordinary owner configuration, where every candidate is listed neutrally with none preselected. An announcement never sets a value, enables a feature or creates a grant.
8. **Owner-only.** No application, integration or other entity can request, word, schedule or suppress an announcement, or observe whether one was made.

Throttling, grouping and dismissal are provider policy. 3sln.me's policy will be a 3sln.me document (forthcoming, `docs/3sln/candidate-surfacing.md`), not part of Bindle.

## 7. Versioning, change and disappearance

[Artefacts](artefacts.md) is authoritative for how fragments change. This section only applies it.

- **Fragments are artefact lines.** At a provider implementing the artefact-versions extension, a publisher MAY add versions at the same fragment URL that are additive under [artefacts §6](artefacts.md#6-additive-change): new fields with `cardinality.min` 0, and values appended to an `extensible` enum. Every other change needs a new fragment URL. At a provider that does not implement artefact-versions, a fragment is a legacy artefact and is immutable at its URL ([artefacts §11](artefacts.md#11-legacy-artefacts-and-compatibility), protocol §3).
- **Descriptors are not artefacts.** They are bundled with implementations and never fetched (§2.3). A descriptor is immutable per spec URL. Any change to it, or any incompatible change to the extension, needs a new spec URL, which the provider declares instead of the old one (§2.2).
- **What is pinned.** A declaration pins nothing, because the spec URL is the whole identity (§2.1). Grants, including provider-feature enablements, pin the fragments and contracts they use. The pin is (URL, digest) under AMD-C2, or the reference (URL, version, digest) under [artefacts §10](artefacts.md#10-grants-consent-and-upgrades) at a provider implementing artefact-versions. Values belong to the fragment line (artefacts §10.2). An application's pin moves under artefacts §10.5. A provider feature's pin moves only when the owner enables it again at the newer version. There is no migration between lines.
- **Artefacts amendments.** AMD-R1 and AMD-R2 stand as proposed in artefacts §14, and this section applies them to fragments. AMD-R3 (declarations carrying `version` and `digest`) is **withdrawn**. A declaration's version is the last segment of its spec URL, and its descriptor is bundled, so a declaration has nothing to pin. Enablements are grants, and pin fragment and contract references under AMD-R2 and artefacts §10.1. AMD-R6 (`extensible`) is listed in the protocol §3 member table as a core member (EXT3-28).
- If a fragment URL starts failing, or serves content that is not an accepted additive version of the pinned line, the provider keeps serving existing values under the pinned copy, keeps existing grants, MAY refuse new requests and enablements until the pinned copy validates, and MUST NOT drop existing values. For enveloped lines, the failure outcomes of [artefacts §7.4](artefacts.md#74-failure-outcomes) govern. A publisher can only publish an additive version or a new line.
- A provider MAY block a fragment or extension version under its own policy. Blocking stops new grants and enablements, reports the affected values `unavailable` to current consumers, revokes the grants and credentials of a blocked extension's provider feature (§4.2), and is visible to the owner.

## 8. Security requirements

1. **Declarations are claims.** No declaration or recorded contract earns a trusted badge. Contract claims are shown as claims by the verified origin.
2. **Exact identifiers.** Extensions, fragments, contracts and consumers match by exact URL. Wherever a title is shown, the host of its identifier is shown too.
3. **No hijacking.** Being declared, connected or most recently connected never places a resource in a field. Inside an authorization flow initiated by a client, no candidate is offered for a field that another consumer already uses or that admits provider consumers if any of these shares a registrable domain with that client: the candidate's origin, its supplying integration's origin, or the origin of its contributing producer client (protocol §3, EXT3-13).
4. **Provider features are disclosed.** They are listed among consumers by descriptor title and host, and enabling one is an owner decision bound to the current values.
5. **Data flows are disclosed.** For each resource, the provider discloses which origin receives invocations and what the field's contracts send there.
6. **Bounded processing.** All §2 bounds apply. Descriptors are never fetched to process a declaration, and non-endpoint URL options are never requested except under §2.4.
7. **No oracle.** Responses visible to applications, integrations or external parties MUST NOT vary with which resources fill, or which other consumers use, a field the observer is not approved for (protocol §3). Announcements generate no traffic to any party (§6.4).

## 9. Conformance tests

Tests MUST cover:

- **Declarations:** spec URL syntax and versions; duplicate `spec` sets and two versions of one line, all absent; unknown extensions ignored; non-recursive prerequisite presence, and a dependent extension treated as absent without it; options validation, scalar and array value shapes, absence only with `min` 0, unknown option members; `endpoint` origin rules, audience distinctness (including the invalidity of every colliding entry, and collisions found only after URL normalisation, such as `https://p.example` against `https://p.example/`), an `enum` option value outside the descriptor making the entry absent, shared public endpoints accepted, and non-endpoint URLs never requested; the embedded-components `embed_origin` exemption applying to that extension only; session-only downgrade.
- **Fragments:** each member-table rule; an unknown member at any level making the fragment unsupported; a member misapplied to a field type making it invalid; `consumers` on an atomic field invalid; a top-level `slot` refused (§10); additive versions at the same URL accepted only under artefact-versions, and a changed legacy fragment rejected (§7).
- **Selection:** both policies; operation snapshot; fresh `tx` per resource; `ordered` failover per error class; no switch after an ambiguous outcome or removal.
- **Consumers:** application requests refused on provider-only fields and the reverse; provider-feature requests carrying no `required`; provider-feature enablement, disclosure, (issuer, spec URL) identity in grants, journals and credentials; suspension on declaration loss, resumption, revocation after 30 days, revocation on blocking; per-consumer, non-preselected approval on add and replace; recent authentication for every enable, and for every add, replace, reorder or fill of a field a provider feature consumes; deterministic `tx` matching the §4.2 example.
- **Candidates and floor:** the four candidate kinds; brokered records satisfying several fields; built-ins never auto-assigned, preselected or ranked first outside initial setup; registrable-domain exclusion inside a client's own flow, including contributed resources produced by that client; `unavailable` only from public facts; no oracle in any app-visible response.
- **Announcements:** only for `announce` fields of approved, enabled consumers, never while the consuming feature is suspended; only after completion, never inside a flow; never for built-ins, adapter resources or provider features; no traffic to the integration; fixed wording without fragment or field titles; at most once per (field, supplier); acting on one never assigns.
- **Lifecycle:** fragment disappearance or change; blocking.

Most of these SHOULD run at the engine level, with seeded chaos tests for selection, failover, suspension and revocation races.

## 10. What revision 3 removes, and compatibility

| Revision 2 item | Revision 3 |
| --- | --- |
| Slots, slot manifests, the `slot` member | Removed. A fragment with resource-field attributes covers every slot use (§3–§6). |
| `slot.crit` | Removed. Versioned URLs and the fail-closed rule for unknown fragment members replace it ([protocol §3](protocol.md#3-fragments-and-preference-values)). |
| `slot.supersedes` and same-origin migration | Removed. A breaking change is a new fragment line, with no migration. Additive versions follow artefacts (§7). |
| `slot.options` (occupant and consumer options) | Removed. Options exist only at extension level (§2.4). |
| AMD-X1 `bind` (bound consumer options) | Removed. Its only user, RTC signaling, was replaced by [signaling](extensions/signaling.md), which moved per-app kind authorization to intents handler approvals and states that it needs no `bind` (signaling §3.2, SG-2, §20.8). The code paths are change request CR-X3-20. |
| Declaration members `slot`, `role`, `ref`, `purpose`, `required` | Removed. Declarations are `{spec, options}`. Integration prerequisites use `setup.fragments` with `required`. |
| Occupant declarations | Removed. Candidates are defined by §5.1. |
| `extensions.v1`, `features`, `profiles` | Removed. The mechanism is core, and every optional part is an extension (§2.8, EXT3-21). |
| `bindle.feature` = `ref` | Replaced by the extension's spec URL (§4.2). |
| `selection: broadcast` and `consumer-choice`, `failover` | Not carried over. `ordered` always fails over pre-dispatch (§3.3). |
| Core amendments C1–C5 | C2–C5 kept. C1 (unknown top-level fragment members ignored) is replaced by the fail-closed member table (protocol §3, EXT3-25). |
| Core amendment C6 | Replaced by the protocol §2 revision 3 text. |

**Compatibility: clean break.** No provider is deployed and production is disabled. Revision 3 processors do not read revision 2 shapes:

- revision 2 entries lack `spec`, so they are ignored;
- `features` and `profiles` are unknown manifest members, so they are ignored;
- a fragment carrying a top-level `slot` member is unsupported, like any fragment with an unknown member, so a former slot can never be processed as an ordinary, application-consumable field.

Former slot documents are republished as fragments at new URLs (Appendix A). Local revision 2 state (occupancy, provider-consumer enablements, bound approvals) is not migrated. It is reset when the code moves, as allowed for pre-release data, and recorded in DEVLOG at that time.

### 10.1 Revision 3.1 changes to the revision 3 draft

Cut: `selection: broadcast` and `consumer-choice`; the `failover` attribute and `any-error`; descriptor `requires` (replaced by prose prerequisites, §2.5); descriptor `provider_features` and feature keys (one feature per extension, identity = spec URL); the declaration `digest`; the descriptor `publisher`; the descriptor fetch path and CORS requirement; `extensions` in integration manifests; the `limit: 0` announcement probe. Changed: the fragment member table and fail-closed rule now cover every member (protocol §3); candidates include brokered offers and adapter resources (§5.1); the announcement floor (§6); suspension instead of revocation on declaration loss (§4.2); the registrable-domain own-flow exclusion (§8.3); endpoint and URL option rules (§2.4); recent authentication for any change to a field a feature consumes (§3.4); the initial-setup exception (protocol §3).

### 10.2 Revision 3.2 changes to the revision 3.1 draft

- **Cut:** declaring several versions of one extension (one version per line; the provider declares a new spec URL instead), and `consumers` on atomic fields.
- **Fragments and artefacts:** fragments follow artefacts, as append-only lines under the artefact-versions extension (§7). AMD-R3 is withdrawn. `extensible` is a core member (EXT3-28).
- **Endpoints:** `endpoint` is `audience` or `public`. Distinctness applies only to audience endpoints, so shared key sets stay valid. A collision invalidates every colliding entry (§2.4).
- **Own-flow exclusion:** it now covers contributed resources produced by the client (§8.3).
- **Wording fixes:** identical prerequisite wording in both specs, with the dependent extension treated as absent when the check fails (§2.5); the journal key carries the feature identity (protocol §5); `directory_url` and every other requested URL is an endpoint option (§2.8); option value shapes and absence (§2.4); suggestions are drawn from every candidate kind (protocol §3 rule 3); provider features send no `required` (§4.2).
- **Components:** the components profile becomes the Bindle-owned embedded-components extension, whose `embed_origin` defines the component origin (§2.7, Q5, provisional, EXT3-29).
- **Change requests:** CR-X3-04 and CR-X3-23 are void, and their surviving parts move to CR-X3-31 and CR-X3-32. Status notes now sit at the top of the dependent specs.
- **Owner sign-offs** of EXT3-25 and EXT3-26 are recorded (§12, §13).

### 10.3 Revision 3.3 changes to the revision 3.2 draft

Reconciliation with the local revision 3.2 implementation (DEVLOG, 2026-10-27, "Extensions revision 3.2 implemented locally"). Every item is provisional (coordinator) and unsigned, except the island location and the audience definition, which the owner approved. Reviewer ___ Date ___ Outcome ___.

- **Incremental intents:** the authorization-entry `intents` option gains `grant-more` and `configure`. The §2.4 rule stands (an unknown enum value makes the entry absent), so both values are in the v1 descriptor from first publication (protocol §2, EXT3-30).
- **Endpoint kinds:** stated for every Bindle-owned extension option (§2.8); `hint_endpoint` is optional (protocol §2).
- **Audience comparison:** WHATWG URL serialisation before comparison (§2.4).
- **Audience definition** (owner-approved 2026-10-28; DEVLOG, 2026-10-28, "Owner approvals and directions (in session)"): an endpoint that receives secret material, such as a portable identity package, is an audience endpoint by definition (§2.4). Portability's `transfer_in_endpoint` is therefore audience without an exception, and the §2.8 table no longer carries one.
- **`tx`:** the UUIDv5 name encoding and an example are fixed (§4.2). The feature identity's serialisation is local; on the wire it is `client_id` plus `bindle.feature`.
- **Embedded components:** `parts` as `<name>/<version>` strings, no per-part FedCM and no FedCM in islands, no `theme_tokens`; islands at the `embed_origin` root, owner-approved (§2.7).
- **Interim RTC:** `…/extensions/rtc-signaling/v1` until signaling Appendix C, never published (§2.8).
- **Enabling** a provider feature always needs recent authentication (§4.2).
- **Announcements:** rule 2 is an upper bound; the minimum is fields consumed by enabled, unsuspended provider features (§6).
- **Applied elsewhere by this revision:** protocol §2 (authorization-entry and integrations rows, audience comparison pointer, status), [integrations §12](extensions/integrations.md#12-feature-declarations) (`hint_endpoint` optional) and [incremental authorization §2](extensions/incremental-authorization.md#2-feature-and-intents) (enum note). Change requests CR-X3-33 to CR-X3-35 (Appendix A) are implemented locally: CR-X3-34 in the review fixes (2026-10-27), CR-X3-33 and CR-X3-35 in the embedded-components migration (2026-10-28).

## 11. Worked examples

### 11.1 Email bridge to Parlay intake

The intake fragment, published by whichever extension owns intake (CR-X3-31):

```json
{
  "id": "https://spec.bindle.example/fragments/public-intake/v1",
  "title": "Receives outside messages",
  "description": "The app that receives messages arriving from outside Bindle, such as email sent to your public address.",
  "publisher": "https://spec.bindle.example",
  "fields": {
    "intake": {
      "title": "Receiving app",
      "type": "resource",
      "cardinality": {"min": 0, "max": 1},
      "contracts": ["https://spec.bindle.example/contracts/public-intake/v1"],
      "selection": "exclusive",
      "consumers": ["provider"],
      "announce": true
    }
  }
}
```

The bridge is the provider feature of an extension the provider publishes itself (§13, Q2). Its descriptor is `{"id": "https://provider.example/extensions/email-bridge/v1", "title": "Email to your messaging app", "description": "Delivers email sent to your public address to the app you choose.", "options": {}}`. The provider declares `{"spec": "https://provider.example/extensions/email-bridge/v1"}`.

1. **Enabling.** The owner enables the bridge in provider settings, with recent authentication. The consent shows the request (field `intake`, method `deliver`) with the descriptor text and the host `provider.example`. If the field is empty, the owner either picks among every candidate implementing `public-intake/v1`, in neutral order with none preselected, or leaves it empty, in which case the bridge holds mail. Saving grants the feature (client identity: issuer, `https://provider.example/extensions/email-bridge/v1`) on the chosen resource only.
2. **Parlay connects** as an integration. Its manifest's `resources.contracts` lists the mailbox and public-intake contracts, recorded at the connection. It declares nothing about intake.
3. **Announcement.** Only because the bridge is enabled (rule 2), and only after the connection is active (rule 1), the provider MAY tell the owner once, from a fixed template, that `parlay.example` claims it can receive messages for the email bridge. It sends nothing to Parlay to decide this (rule 4). If the bridge was never enabled, nothing is announced.
4. **Delivery.** The bridge reads its projection and calls `deliver` with a brokered token (`client_id` = issuer, `bindle.feature` = the spec URL) and `tx` = UUIDv5(spec URL, contract, entity, ingress fingerprint).
5. **Empty or unavailable field.** The bridge holds the mail. Its SMTP behaviour and fixed auto-reply never vary with the field's state (no oracle). Hold and reply rules are 3sln.me policy.
6. **Switching** to another app is an owner action in settings, re-approving the bridge for the new resource with recent authentication (§3.4). It is never offered inside Parlay's, or another app's, flow. Disabling the bridge revokes its grant.

### 11.2 Signaling

The provider manifest lists the built-in contracts and declares the extension and the prerequisites that the signaling spec names in prose:

```json
"contracts": ["https://spec.bindle.example/contracts/signaling/v1",
              "https://spec.bindle.example/contracts/ice-relay/v1"],
"extensions": [
  {"spec": "https://spec.bindle.example/extensions/directory/v1",
   "options": {"directory_url": "https://provider.example/bindle/directory"}},
  {"spec": "https://spec.bindle.example/extensions/artefact-versions/v1"},
  {"spec": "https://spec.bindle.example/extensions/signaling/v1",
   "options": {"endpoint": "https://provider.example/bindle/signaling",
               "max_leg_certificate_seconds": 600, "profiles": ["data", "webrtc"]}}
]
```

In the directory extension's descriptor, `directory_url` is a public endpoint option, and in the signaling extension's descriptor, `endpoint` is an audience endpoint option (§2.4).

The Signaling extension publishes two fragments:

- `…/fragments/signaling/v1`: field `signaling`, cardinality 0–1, contract `signaling/v1` (non-brokerable), `selection: "exclusive"`, `consumers: ["application", "provider"]`;
- `…/fragments/ice-relay/v1`: field `relays`, cardinality 0–4, contract `ice-relay/v1`, `selection: "ordered"`, `consumers: ["application", "provider"]`.

The provider's built-in signaling resource is a candidate in each owner's pool, assigned only by the owner. An app requests `…/fragments/signaling/v1` with its digest and methods. Kind authorization stays with intents handler approvals (signaling §20.1). A provider feature that holds sessions, such as an answering service, is the feature of its own extension. Its leg certificates carry `client.feature` = that extension's spec URL.

## 12. Decisions (provisional, unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| EXT3-1 | `features` and `profiles` are removed. Every optional part, Bindle-owned or third-party, is an extension declared in the provider manifest's `extensions` (§2.1, §2.8). OAuth flat members and the required manifest members stay. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-2 | A declaration is `{spec, options}`. The spec URL is the identity, versioned in its last path segment. A provider declares at most one version of a line, and an incompatible change is a new spec URL declared instead of the old one (§2.2; revision 3.2 cut multi-version declarations). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-3 | Each version has an immutable descriptor holding user-facing text and the options schema. Processors hold descriptors for the extensions they implement and never fetch one to process a declaration. No digest, publisher or required fetch location (§2.3). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-4 | Options use the atomic field members plus `endpoint` (`audience` or `public`). A `max` 1 option is a scalar, otherwise an array, and it may be absent only with `min` 0. Endpoint options are on the issuer origin, except the one core names (§2.7). Audience endpoints are distinct from every other audience endpoint, and a collision invalidates every colliding entry. Public endpoints, such as a shared JWKS document, may share URLs. Non-endpoint URLs are never requested unless the extension spec says so and they are on the declarer's origin (§2.4). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-5 | Bounds: 48 entries, 4 KiB each. Duplicate `spec` entries, and entries for two versions of one line, are all absent. No generic `requires`: prerequisites are prose, checked by non-recursive presence of exactly one entry, and a dependent extension whose prerequisite is missing is absent (§2.5). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-6 | Integration manifests carry no `extensions`. Integration roles keep dedicated `bindle_integration` members, and extensions no longer force confidential clients (§2.1, §2.6). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-7 | Only core-named exceptions (brokered resources, and the component-origin envelope for the embedded-components extension's declared `embed_origin`) let an extension change core processing (§2.7). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-8 | Slots are removed. `selection` (`exclusive` or `ordered`, ordered always pre-dispatch) is a core resource-field attribute usable by any fragment (§3, protocol §3). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-9 | `consumers` is a core resource-field attribute, default `["application"]`. Provider features may consume only fields that list `provider` (§4). Atomic fields do not carry it (revision 3.2 cut). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-10 | An extension defines at most one provider feature. Its client identity is (issuer, spec URL) in grants, journals, credentials and `tx` derivation, and it is enabled through an ordinary grant with owner consent (§4.2). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-11 | No `ref`, keys or local ids. User-facing text comes only from descriptors and fragment metadata (§2.1, §2.3). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-12 | Candidates are built-ins, adapter resources, brokered offers and records, and contributed resources whose contracts satisfy the field. Brokered records keep their full validated claim (§5.1). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-13 | The core owner floor (protocol §3) now covers **every** resource field, not only former slots: owner-only assignment, no oracle, suggestions only from recorded contracts, no preselection, no self-preferencing, and the registrable-domain own-flow exclusion on shared and provider-consumable fields (candidate origin, supplying integration or contributing producer client). This widens revision 2, where these rules applied to slot occupants only. The one exception is the provider's initial account setup. **Why the exclusion stops at shared and provider-consumable fields:** on a fresh field that only the requesting application consumes, offering that application's own resource takes nothing from any other consumer. If the owner later shares the field, every other consumer needs its own per-consumer approval of each resource, with the resource's origin shown and nothing preselected (§3.4). This narrowing is deliberate. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-14 | `announce` (boolean, publisher opt-in per resource field) permits post-connection, owner-only announcements under the §6 floor. Detailed surfacing is 3sln.me policy. The name `announce` is chosen over `verbose`, because it names the one thing it permits, whereas `verbose` reads as an output level. `notify` collides with notifications, and `suggest` implies a provider recommendation or preselection. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-15 | Fail closed: a fragment with any member outside the protocol §3 member table, at any level, is unsupported. New attributes therefore mean new fragment versions, and every provider reports such a fragment `unsupported` deterministically. This replaces `crit`, and covers a top-level `slot` (§10). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-16 | AMD-X1 `bind` is dropped. Signaling revision 2 no longer needs it, as verified in signaling §3.2, SG-2 and §20.8. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-17 | `supersedes` and version migration are dropped (§7). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-18 | Clean break with revision 2: its shapes are ignored or refused, slot documents are republished as fragments at new URLs, and local revision 2 state is reset when the code moves (§10). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-19 | Core amendments C2–C5 are kept. C1 is replaced by the member table (EXT3-25). C6 is replaced by the protocol §2 revision 3 text (§10). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-20 | Optional `unavailable` outcomes may follow only from public facts, now including the manifest `contracts` list of built-in contracts (§4.3). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-21 | **Needs owner sign-off.** "Core" is the conformance floor plus the extension mechanism. The areas the owner listed as core (intents, hub connectivity, events) and the other §2.8 areas are Bindle-owned extensions in the core document set (§1). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-22 | Cuts with no current user: `broadcast`, `consumer-choice`, `failover`/`any-error`, `requires`, `provider_features` and keys, declaration `digest`, descriptor `publisher`, descriptor fetch and CORS, integration `extensions` (§10.1). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-23 | Declaration loss or a withdrawing options change suspends provider-feature grants. Revocation follows owner disabling, 30 days of continuous suspension, or blocking. Narrowing applies immediately (§4.2). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-24 | Announcement floor: only after an owner action completes, only for fields approved for an enabled consumer, never for the provider's own built-ins, adapter resources or features, computed locally with no traffic to the integration, fixed wording without app-written titles, at most once per (field, supplier) (§6). The `limit: 0` probe is withdrawn. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-25 | **Owner-approved (reverses AMD-C1, provisionally approved 2026-10-20).** Protocol §3 holds an exhaustive table of fragment and field members. Unknown members anywhere fail closed. A row naming an extension counts only at providers implementing it. | Reviewer owner (in session) Date 2026-10-27 Outcome approved ([DEVLOG](../../DEVLOG.md), "Owner sign-offs (EXT3-25, setup exception)") |
| EXT3-26 | Initial-setup exception: during the provider's own initial account setup, it MAY offer its built-in as a labelled choice, never preselected, beside an equally prominent "not now", and only an explicit owner choice fills the field (protocol §3 rule 3). **Owner-approved** (§13 Q6). | Reviewer owner (in session) Date 2026-10-27 Outcome approved ([DEVLOG](../../DEVLOG.md), "Owner sign-offs (EXT3-25, setup exception)") |
| EXT3-27 | Recent owner authentication for any add, replace, reorder or fill of a field consumed by an enabled provider feature, never inside an app's flow (§3.4). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-28 | Fragments follow [artefacts](artefacts.md), which is authoritative. They are append-only lines with additive versions at the same URL under the artefact-versions extension, and immutable legacy artefacts without it. Descriptors are bundled and immutable per spec URL. Declarations pin nothing, and grants and enablements pin fragment and contract references (AMD-R2). AMD-R3 is withdrawn. `extensible` (AMD-R6) is a core member of the protocol §3 table, harmless without growth. No row currently uses the extension-conditional rule of EXT3-25 (§7). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-30 | Rev 3.3: the authorization-entry `intents` enum is exactly `login`, `select-account`, `reauthenticate`, `end-session`, `grant-more`, `configure`. An unknown value makes the entry absent (§2.4 unchanged); further intents need a new spec URL or their own extension. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-31 | Rev 3.3: endpoint kinds of §2.8 and protocol §2 as listed, including `transfer_in_endpoint` as audience (now by the §2.4 definition, whose secret-material case is owner-approved 2026-10-28; the rest of this row stays unsigned) and the intent-links `endpoint` as public; `hint_endpoint` optional. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-32 | Rev 3.3: audience endpoints compare by WHATWG URL serialisation (§2.4). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-33 | Rev 3.3: UUIDv5 `tx` name is the `|`-joined UTF-8 inputs in the URL namespace (§4.2). A structured encoding (for example JCS of an array) remains open before publication. | Reviewer ___ Date ___ Outcome ___ |
| EXT3-34 | Rev 3.3: embedded-components options (`parts` as `<name>/<version>`), no FedCM in islands, no `theme_tokens` (§2.7). The island location at the `embed_origin` root is owner-approved separately (DEVLOG, 2026-10-27, "Owner direction: keep `embed_origin`; islands document at the origin root"). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-35 | Rev 3.3: interim `…/extensions/rtc-signaling/v1` behind default-off flags until signaling Appendix C, never in a published manifest (§2.8). Retired 2026-10-28 when the signaling engine phase landed locally (provisional). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-36 | Rev 3.3: enabling a provider feature always needs recent authentication (§4.2). Announcement scope minimum is fields consumed by enabled, unsuspended provider features (§6 rule 2). | Reviewer ___ Date ___ Outcome ___ |
| EXT3-29 | **Provisional (owner told it is adopted unless they object; not signed off).** The components profile becomes the Bindle-owned embedded-components extension (`…/extensions/embedded-components/v1`, placeholder), with its content unchanged and republication pending. Its `embed_origin` is a public endpoint option, exempt from the issuer-origin rule for this extension only and authoritative because the issuer's manifest declares it. The core component-origin envelope uses the origin of that option, and its safety conditions stay. They exist because of framing and browser storage partitioning, not doubt about ownership (§2.7, Q5). | Reviewer ___ Date ___ Outcome ___ |

## 13. Owner questions

The owner delegated direction to the coordinator. Q1 and Q2 have provisional coordinator answers (DEVLOG, 2026-10-27, "Extensions rev 3 open questions: provisional coordinator answers"). The owner approved Q4 and Q6 on 2026-10-27 (DEVLOG, "Owner sign-offs (EXT3-25, setup exception); components direction; contacts spike rev 2; address-routing reconciliation"). Q3 needs owner sign-off, and Q5 has a provisional answer.

1. **Attribute name.** `announce` in place of `verbose`. *Provisional answer: yes* (EXT3-14).
2. **Email bridge identity.** *Provisional answer: the provider feature of a provider-published extension* (§11.1), keeping email policy out of Bindle.
3. **What "core" means.** *Proposed, still pending owner sign-off:* the reading in §1 (EXT3-21). It covers intents, intent links, integrations, brokered resources, events, authorization entry and device authorization, not only events.
4. **Unknown fragment members.** *Owner-approved 2026-10-27: fail closed* at every level, which reverses AMD-C1 (EXT3-25). The intended cost is that every new attribute needs a new fragment version.
5. **Components exception.** *Provisional answer: option 1.* The components profile is republished as the Bindle-owned embedded-components extension, and core's component-origin envelope names that extension's declared `embed_origin` (§2.7, EXT3-29, CR-X3-16). The owner was told this is adopted unless they object. It is not signed off.
6. **Initial-setup exception.** *Owner-approved 2026-10-27:* the strict form of EXT3-26. The built-in is never preselected and sits beside an equally prominent "decide later".

## Appendix A. Migration and impact (change requests, not applied)

Every request below is proposed and unsigned. None is applied by this draft unless it says so. Revision 2 is frozen at [superseded/extensions-rev2.md](superseded/extensions-rev2.md), and revision 3.1 repointed every spec link into revision 2 anchors to that copy (pure link fixes). Links from `docs/architecture/*` (local-clients spike, extension catalogue spike, consent experience) still point at removed anchors and are left to their owners. Revision 3.2 adds a one-line status note to the top of each dependent spec whose text contradicts this draft or protocol §2–§4. The note points here, and these specs carry one: integrations, events, organizations, rtc-signaling, signaling, messaging, intents, device authorization, incremental authorization, links, auth, app removal, federation implementation, artefacts and identity portability. Contracts (already reworded under CR-X3-02), security and resource contributions (whose "slots" are call slots) do not contradict this draft and carry no note.

### A.1 Specifications

| ID | Document | Change request |
| --- | --- | --- |
| CR-X3-01 | [protocol](protocol.md) | **Applied by this draft:** §2 (`features` and `profiles` replaced by `{spec, options}` declarations, the processing rules and the Bindle-owned extension table), §3 (the exhaustive member table, fail-closed rule, field attributes and owner floor) and §4 (provider-feature client identity), and the revision 3.2 changes: one version per line, `consumers` on resource fields only, `extensible` as a core member, audience-only endpoint distinctness, prerequisite wording, the journal key carrying the feature identity (§5), candidate kinds in suggestions, contributed resources in the own-flow exclusion, a fragment versioning note, and the embedded-components exception. Its status notes remain provisional. |
| CR-X3-02 | [contracts](contracts.md) | **Applied by this draft (wording only):** AMD-C10's slot wording no longer refers to slots or `any-error`. Whether `effect` values keep another user is left to contracts. |
| CR-X3-03 | [signaling](extensions/signaling.md) | Header and §3.1: replace the `signaling.v1` feature with the extension declaration of §11.2 (options unchanged; the directory and artefact-versions prerequisites stated in prose; no `extensions.v1`). §3.2–§3.3: replace the slot manifests with the two fragments of §11.2, and drop the occupant declaration (the built-in is implied, and its contract is listed in `contracts`). §4.2 items 1–4: a provider feature is the one feature of its own extension, enabled through a grant (§4.2 here). §4.2 item 3, §6.1 `client.feature`, §20.1 handler identification: `ref` becomes the feature's spec URL. §20.5 (AMD-SG-P1): replace the feature-table row with an extension descriptor. §20.8: mark AMD-X1 withdrawn. "Offers the slot" wording becomes "supplies the built-in signaling resource". |
| CR-X3-04 | [messaging](extensions/messaging.md) | **Void** (2026-10-27, DEVLOG "address-routing reconciliation"). The contacts and links spike withdraws the messaging-address descriptor (CL-4, CR-X1), which overrides this request. Its parts that do not concern addresses are restated in CR-X3-31. |
| CR-X3-05 | [organizations](extensions/organizations.md) | §14 feature table (`directory.v1`, `organizations.v1`, `key-delegation.v1`, `relations.v1`): extension declarations with the same members as options; prerequisites stay prose. Every "declares `x.v1`" reads "declares the x extension". |
| CR-X3-06 | [device authorization](extensions/device-authorization.md) | `device-authorization.v1` becomes its extension URL. References to `authorization-entry.v1` and `client-id-metadata.v1` become extension names. The local-clients spike's flag proposals (`LOCAL_CLIENTS_ENABLED`) declare an extension if adopted. |
| CR-X3-07 | [integrations](extensions/integrations.md) | **Applied by this draft:** §2.1 no longer lists "an `occupant` extension" as a confidential-client trigger. **Proposed:** §1: "occupy or consume slots" becomes "supply resources and consume fields". §2.1 example, §2.2 members table and §2.3 change table: the `extensions` member is removed (**applied by this draft**, §2.1 here). §4.1: unchanged; announcements cause no provider-initiated discovery. §4.3: a brokered record stores the full validated claim (discovery claim ∩ manifest list); narrowing to a field's contracts happens per grant. §5.1: "brokered occupant" becomes "brokered resource". §5.3: `bindle.feature` = the feature's spec URL; `bindle.grant` changes on value change instead of occupant change; brokered journals key on (`iss`, `sub`, `client_id`, `bindle.feature`, `tx`). §11 item 9: "slot changes" becomes "field changes". §12: replace the feature table with extension declarations. §14 C11: replaced. |
| CR-X3-08 | [incremental authorization](extensions/incremental-authorization.md) | §2: the `intents` set becomes the authorization-entry extension's `intents` option. §4.2: repoint to revision 3 §3.4 and §8.3 (registrable-domain exclusion on shared and provider-consumable fields). §5.1: "slot or bus field" becomes "field with `selection`, or a bus field". §5.2 rule 1: "slot occupants or bus choices" becomes "resource values". The components profile becomes the embedded-components extension (§2.7, Q5 provisional). |
| CR-X3-09 | [events](extensions/events.md) | A bus manifest becomes a fragment with one resource field (`selection: "exclusive"`, cardinality 0–1, contract `event-bus/v1`). Bus semantics (`publishers`, `readers`, the reader floor) MUST fail closed at a provider without the events extension, so they become a **field member** added to the protocol §3 member table as defined by the events extension, not an ignorable top-level member. This would be the first row to use the extension-conditional rule (EXT3-25). `readers` ⊆ the field's `consumers`. The generic built-in occupant rule becomes a built-in event-bus resource created on owner action, with its contract listed in `contracts`. Drop `slot.crit`, `slot.supersedes` and the §12 rows about `extensions.v1`. `events.v1` becomes its extension URL. The provider-consumer `ref` becomes the feature's spec URL. |
| CR-X3-10 | [intents](extensions/intents.md) | `intent-links.v1` becomes an extension URL; `intents.v1` is withdrawn instead (contacts spike CL-11, CR-I1). Built-in handler declarations by provider features identify the feature by its spec URL. References to `directory.v1`, `client-id-metadata.v1` and `artefact-versions.v1` become extension names. |
| CR-X3-11 | [links](superseded/links.md) | **Void** (2026-10-28, contacts and links spike CR-P1, CR-X1; provisional). links is dissolved: `link-response.v1` and `intents.v1` are withdrawn rather than converted, and messaging address routing is withdrawn (CL-4). |
| CR-X3-12 | [federation implementation](federation-implementation.md) | **Applied by this draft:** the public-fact link now points to §4.3. **Proposed:** `integrations.v1`, `client-id-metadata.v1` and `brokered-resources.v1` become extension names. Replace any manifest example that carries `features`. |
| CR-X3-13 | [auth](auth.md) | **Applied by this draft:** the component-origin envelope now names the embedded-components extension's declared `embed_origin`, exempt from the issuer-origin rule, and states why its conditions exist (§2.7, EXT3-29). **Proposed:** `fedcm.v1`, `client-id-metadata.v1` and `brokered-resources.v1` become extension names. |
| CR-X3-14 | [app removal](extensions/app-removal.md), [artefacts](artefacts.md), [identity portability](extensions/identity-portability.md), [resource contributions](extensions/resource-contributions.md), [security](security.md) | Their feature identifiers (§2.8) become extension declarations. Artefacts: AMD-R3 is withdrawn (§7, EXT3-28). AMD-R6 `extensible` is listed in the protocol §3 member table as a core member (**applied by this draft**, provisional). The §5 "`slot` in extension declarations" container and the `slot` reference kind, and the §6.3 `slot` growth rows, are removed. AMD-R5's `slot.bus` member follows CR-X3-09. §12 and AMD-R7 become the §2.8 rows. App removal: `jwks_uri` and `return_uri` are public endpoint options and `completion_endpoint` is an audience endpoint option, so AR-5's shared JWKS document stays valid (§2.4). |
| CR-X3-15 | [rtc-signaling](superseded/rtc-signaling.md) | **Applied by this draft:** a status note that it relies on revision 2 slots and AMD-X1, which revision 3 removes. Its links point to the frozen revision 2 copy. |
| CR-X3-16 | [components profile](../profiles/components-v1.md) | **Provisional answer to Q5 (EXT3-29):** republish as the Bindle-owned embedded-components extension (`https://spec.bindle.example/extensions/embedded-components/v1`, placeholder). Its descriptor `options` hold the profile's current members. `embed_origin` is a public endpoint option, exempt from the issuer-origin rule, and `manage_url` is a public endpoint option. Content is unchanged until republication. **Applied by this draft:** the profile's status line notes this. |
| CR-X3-17 | Architecture docs | [extensibility design](../architecture/extensibility-design.md), the [extension catalogue spike](../architecture/extension-catalogue-spike.md) (P1, P2, P5), [consent experience](../architecture/consent-experience.md) and the [local-clients spike](../architecture/local-clients-spike.md): note them superseded by revision 3, and repoint their revision 2 anchors to the frozen copy. The feature registry becomes a registry of extension descriptors. |
| CR-X3-33 | [auth](auth.md), [components profile](../profiles/components-v1.md) | Rev 3.3 (provisional): the component-origin envelope no longer covers FedCM assertions, because islands never delegate to FedCM. The profile drops per-part `fedcm` and `theme_tokens`, encodes `parts` as `<name>/<version>` options, and moves the island document to the `embed_origin` root (§2.7; the root location is owner-approved). |
| CR-X3-31 | [messaging](extensions/messaging.md) | Restates the parts of void CR-X3-04 that do not concern addresses. §9: the intake slot becomes the §11.1 fragment, published by whichever extension owns intake. The `email-bridge` consumer becomes the feature of a provider-published extension (Q2). `tx` uses UUIDv5 over (spec URL, contract, entity, fingerprint). "extensions §9.8" becomes protocol §3, no oracle. `key-delegation.v1` becomes its extension URL. The `messaging-address` consumer stays withdrawn under the contacts spike. **CR-X1 (contacts spike; applied 2026-10-28 in messaging §2.1, §2.5 and §3.2, provisional):** the §2.1 messaging-ingress slot becomes the fragment `…/fragments/messaging-ingress/v1`, whose one field `mailbox` is consumed only by the provider feature of the Messaging-published extension `…/extensions/messaging-mailbox/v1` (prerequisite: key-delegation), under §4.2 (grant request with method `describe`, owner enablement with recent authentication). Key delegation certifies the Messaging purposes only through that feature, so only the installation supplying the assigned `mailbox` resource receives them; `key-delegation.v1` itself stays Messaging-agnostic. |

### A.2 Code and artefacts (flags stay off; nothing changes until sign-off)

| ID | Area | Change request |
| --- | --- | --- |
| CR-X3-18 | `packages/federation/extensions.mjs`, `packages/federation/schema.mjs` | Replace slot validation, (`slot`, `role`, `ref`) triples and slot pins with: `{spec, options}` parsing, a bundled descriptor registry, options validation (scalar and array shapes; `endpoint` origin, audience distinctness with every colliding entry invalid, and the `embed_origin` exemption), one version per line, prose-prerequisite presence checks and duplicate handling. Add field-attribute validation (`selection`, `consumers`, `announce`). |
| CR-X3-19 | `packages/runtime/federation.mjs` `MANIFEST_DECLARATIONS` | Rows emit `extensions` entries instead of `features` keys. Remove the `extensions.v1` row. Move the `routes/directory.mjs` wrapper declarations into rows with `mounted` checks, and add an events row (spike P4). Keep the "mounted, not just flagged" rule. |
| CR-X3-20 | `packages/federation/service.mjs` and the consent kit | Remove AMD-X1: request `options`, `bound` grant records, `federation.narrow-bound-options`, `federation.bound-approval`, the bound `grant-more` refusal and the shared consent kit's bound values. Enforce `consumers` per field. |
| CR-X3-21 | `packages/app/domains/connections.mjs`, `packages/apps/connections.mjs` | Generation-fenced occupancy and provider-consumer enablements become field values plus provider-feature grants with client identity (issuer, spec URL), with suspension and 30-day revocation. Remove `PUBLIC_INTAKE_MANIFEST` and the other slot imports. |
| CR-X3-22 | `packages/federation/brokered.mjs` | `bindle.feature` becomes the spec URL, and brokered journals include it in their key. `bindle.grant` changes on value change. Records keep the full validated claim. |
| CR-X3-23 | `packages/runtime/account/email-bridge.mjs`, `packages/links/types.mjs` (module removed with contact links in contacts phase 4, 2026-10-28) | **Void** (2026-10-27, DEVLOG "address-routing reconciliation"). `MESSAGING_ADDRESS_DECLARATION` is withdrawn by the contacts spike (CL-4, CR-X1). The bridge parts are restated in CR-X3-32. |
| CR-X3-24 | `packages/rtc/extension.mjs` | Follows the signaling implementation plan (signaling Appendix C). It is built directly in the revision 3 shape, with no slot. |
| CR-X3-25 | Classifier: `packages/runtime/account/classifier.mjs`, `packages/messaging-engine/domains/classify.mjs`, `packages/core/tags.mjs`, `packages/core/public-contracts.mjs` | **Applied locally except the core enum (2026-10-28, provisional, unsigned; flags off):** the Bindle [item-classification contract and fragment](extensions/item-classification.md) replace `decision-model/v1` and the 3sln.me item-classifier fragment (removed, not kept resolvable: owner direction 2026-10-28, no versioning churn before release). Redesigned under the owner directions of 2026-10-28: `capabilities` plus `classify` (inline bytes or presigned-URL items, bounded tags, caller-supplied labels), per-kind classifier fields with a fallback and owner-chosen detail per field. 3sln.me keeps a paid built-in on its own Workers AI account (text only, plan-scaled allowances). Parlay supplies its own categories. Open: the security review of labels and presigned-URL fetching, and removal of the core classification enum in `packages/core/tags.mjs`. |
| CR-X3-26 | `docs/artefacts/slots/*.json`, `docs/artefacts/artefacts.lock.json` | Retire the slot artefacts (item-classifier, messaging-ingress, public-message-intake). Publish fragments under `docs/artefacts/fragments/` at new URLs, and descriptors under `docs/artefacts/extensions/`. The 3sln.me item-classifier slot (and the interim item-classifier fragment) were removed outright on 2026-10-28 (owner direction: pre-release artefacts are rewritten in place, not kept resolvable). |
| CR-X3-27 | `packages/messaging-protocol/constants.mjs`, `apps/parlay/integration.json`, Parlay pins | Slot URLs become fragment URLs. Drop Parlay's occupant declarations and keep `resources.contracts`. The pinned slot digests (`tests/messaging-cut.test.mjs`) become fragment digests. |
| CR-X3-28 | Tests | Rewrite `tests/brokered-records`, `integrations-manifest`, `messaging-cut`, `engine-connections`, `classifier-occupant`, `contract-registry` (and the worker copy), and `parlay/worker-integration`. Add §9 coverage, mostly at the engine level, with seeded chaos tests. |
| CR-X3-29 | Data | Reset local revision 2 extension state (occupancy, enablements, bound approvals) when CR-X3-18 to CR-X3-22 and CR-X3-32 land, and record it in DEVLOG. |
| CR-X3-30 | `packages/federation/schema.mjs:19`, `packages/core/artefacts.mjs:119` | Align both validators with the protocol §3 member table. Today they disagree: `artefacts.mjs` accepts `extensible` and `schema.mjs` does not; `artefacts.mjs` requires safe-integer `minimum`/`maximum` where `schema.mjs` accepts finite numbers; neither knows `selection`, `consumers` or `announce`; and `validateSchema` ignores unknown top-level members, which now fail closed. One shared validator is preferred. |
| CR-X3-34 | `packages/core/extensions.mjs` `readExtensions` | Rev 3.3: compare audience endpoints by WHATWG serialisation (§2.4). Today it compares raw strings, and option validation accepts both `https://p.example` and `https://p.example/`, so that pair does not collide. Normalise the flat members too. |
| CR-X3-35 | `packages/sdk/src/islands-protocol.mjs` `islandURL`, embed host routing, tests | Island document at `<embed_origin>/` instead of `/embed` (owner-approved; part of CR-X3-16). |
| CR-X3-32 | `packages/runtime/account/email-bridge.mjs` | Restates the bridge parts of void CR-X3-23. `integrationsIntakeSeat` checks the intake field value and the bridge feature grant. The `tx` input becomes (spec URL, contract, entity, fingerprint). |
