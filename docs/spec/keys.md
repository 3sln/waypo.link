# Signed objects and signature domains — normative draft

> **Group:** Bindle core
>
> **Status:** draft, 2026-10-27, provisional and unsigned (contacts and links spike CL-2, CR-K1). That this profile lives in a short core `keys.md` (contacts spike §11 Q2) is owner-approved 2026-10-28; the text itself is not signed off. The text below is moved unchanged in substance from links §3.1 (the JWS profile) and links §7.2 (the signature-domain table); only its scope is generalized. The shared core module is `packages/core/signed-object.mjs` (contacts spike CR-C0). The Organizations link envelope keeps its own parser and signer in `packages/orgs/link-envelope.mjs`, which replaced the removed `packages/links/envelope.mjs` in contacts phase 4 (CR-C2); its verifier exceptions are stated in its annex §3.1. Nothing is production-verified.
>
> **Covers:** the strict JSON rules and compact JWS profile every Bindle signed object uses, and the rule that keeps objects signed by one key separable (signature domains).
>
> **Does not cover:** where keys come from or how they are discovered (identity documents and key discovery are in [Organizations §3a](extensions/organizations.md#3a-identity-documents-and-key-discovery-directoryv1)); identity moves, provider transfer keys and successor pins ([identity portability](extensions/identity-portability.md)); the meaning of any particular signed object (each profile's own spec); artefact integrity digests ([artefacts](artefacts.md)); the link query envelope ([Organizations link envelope annex](extensions/organizations-link-envelope.md)).

MUST, MUST NOT, SHOULD and MAY express draft requirements.

## 1. Scope

A **signed object** is a compact JWS that a Bindle specification defines: for example a signaling leg certificate or message, an identity-portability move record or acceptance, a key-delegation or member certificate, a signed intent, or a link envelope meta. A **profile** is the specification that defines one signed object: its permitted algorithms, its exact protected header, its `typ`, its exact payload members and its key authority.

Every profile uses the rules of §2 and §3 unless it states a stricter rule. Profiles MUST NOT relax them.

## 2. Strict JSON

The decoded protected header and payload MUST be strict UTF-8 [I-JSON](https://www.rfc-editor.org/rfc/rfc7493) objects. A verifier MUST reject:

- duplicate member names at any depth;
- members the profile does not define (each profile gives an exact member set);
- integers outside the safe range, non-finite numbers and `-0`;
- lone surrogates;
- nesting deeper than 8 levels.

Where a profile needs a canonical form (for example to compute a digest), it uses the canonical form of [artefacts §3](artefacts.md#3-strict-parsing-and-canonical-form). A signature never depends on a canonical form: see §3.

## 3. Compact JWS profile

1. **Serialization.** [JWS](https://www.rfc-editor.org/rfc/rfc7515) compact serialization with three segments in canonical unpadded base64url. Segments with noncanonical trailing bits are rejected.
2. **Header.** The protected header contains exactly the members the profile gives. `jku`, `jwk`, `x5u`, `x5c`, `crit`, `b64`, `zip` and `cty` are not permitted. `kid` is 1–200 characters without control characters.
3. **Algorithms.** ES256 signatures are the raw 64-byte `r||s` form ([RFC 7518](https://www.rfc-editor.org/rfc/rfc7518) §3.4); EdDSA follows [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037). Both produce exactly 64 signature bytes; any other length is rejected. `none`, HMAC, and embedded or remotely fetched keys are unavailable. A profile names which of the two algorithms it permits. An ES256 signer MUST emit low-S signatures (`s ≤ n/2`), normalizing after signing where the platform (for example WebCrypto) may return high-S, (2026-10-28, provisional, unsigned). Each profile states whether its verifiers reject high-S; the core module rejects it. The [Organizations link envelope](extensions/organizations-link-envelope.md) §3.1 accepts high-S, and `EdDSA`, only on stored legacy metas, with single use keyed on `jti` and the exact stored bytes.
4. **Signing input.** The signature input is the ASCII bytes of the **received** `segment1 "." segment2`. Verifiers MUST NOT re-serialize, canonicalize or reorder JSON before verifying, and MUST NOT accept a different encoding of the same JSON.
5. **Keys.** A verifier never accepts a key from the object itself, from a JWS header, from the party presenting the object, or from an unauthenticated fetch. It resolves `kid` only through a key authority the profile names (for example the issuer's own registered keys, or keys discovered under Organizations §3a with pinned continuity).

## 4. Signature domains

One key may sign several kinds of object. In the reference host, for example, one per-account P-256 signing key signs several profiles. Every profile a key signs MUST be separable from every other:

- Every JWS profile verified against a key MUST check its exact `typ` before using any claim.
- Every non-JWS profile MUST carry a distinct domain prefix in its signing input. A COSE_Sign1 profile carries its domain as the `external_aad` of the RFC 9052 Sig_structure and MUST also check an exact protected `typ`; a Sig_structure begins with the byte `0x84`, so it never equals a JWS signing input.
- A provider MUST NOT sign caller-supplied bytes with an identity key. It signs only objects it constructs itself.
- Adding a profile requires adding a row to the table below, or to a profile-specific table that this section names.

| Signed object | Input form | Separation | Defined in |
| --- | --- | --- | --- |
| `bindle-link-meta+jwt` (organization and relation invitation link types) | JWS input | `typ`, `bindle` magic, `type`, exact stored claims | [Organizations link envelope](extensions/organizations-link-envelope.md) §3; types in [Organizations](extensions/organizations.md) §5.1, §9.4 |
| `bindle-relation-participation+jwt` (identity signing key) | JWS input | `typ` | [Organizations](extensions/organizations.md) §9.3 |
| `bindle-relation-event+jwt` (certification key) | JWS input | `typ` | [Organizations](extensions/organizations.md) §9.9 |
| Integration event, untagged COSE_Sign1 CWT (brokering `event` key; CBOR phase 5, provisional) | RFC 9052 Sig_structure, deterministic CBOR | protected `typ` `application/vnd.bindle.integration-event+cwt` plus `external_aad` `bindle-integration-event-v1`; distinct `kid` per brokering purpose | [Integrations](extensions/integrations.md) §6.1; [CBOR profile](cbor.md) §9 |
| DPoP proofs presented with `BindleMember` or `BindleEntity` (the certified key, never an identity key) | JWS input | `typ` `dpop+jwt` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html)) | [Organizations](extensions/organizations.md) §5.2, §9.5 |
| Legacy `contact+jwt`, `bindle-contact-endpoint+jwt`, `bindle-inbox+jwt` (removed with contact links in contacts phase 4, 2026-10-28; no longer issued or verified; the `typ` values stay reserved) | JWS input (`eyJ…`) | `typ`, exact stored claims | Parlay legacy record |
| Conversation v1 payloads (legacy, implemented) | Raw canonical JSON (`{…`), **no domain prefix** | First byte `{` versus `e` | Parlay legacy record |
| Contact-delivery and conversation-v2 proofs (candidates; being withdrawn) | `bindle-…-v1\n` / `-v2\n` domain prefix plus JCS | Prefix | Parlay legacy record |

The unprefixed conversation-v1 form is a legacy exception: new profiles MUST NOT copy it.

The Organizations rows were merged from AMD-O7 on 2026-10-28 (contacts spike CR-O1; provisional, unsigned). The former `bindle-link-data+jwt` row is dropped with link audiences (CL-3): no link type defines data ([annex §4](extensions/organizations-link-envelope.md#4-bindle_data-reserved)).

**Rows proposed elsewhere (not yet merged into this table).** These amendments add rows and are pending with their own specifications: Organizations AMD-O12 (member and entity certificates), [intents](extensions/intents.md) AMD-I5 (`bindle-intent+jwt`), [signaling](extensions/signaling.md) (leg certificate, control statement and message `typ` values; SG-41), [identity portability](extensions/identity-portability.md) AMD-P5 (`bindle-identity-move+jwt` and `bindle-move-acceptance+jwt`, signed by provider transfer keys, never identity keys; DPoP proofs on the migration channel, signed by a per-move key; revision 4, 2026-10-28, provisional), and [Bindle Messaging](extensions/messaging.md) §3 (key-delegation and author proofs). Until they are merged, each is authoritative in its own specification, and none may reuse another's `typ` or prefix.

## 5. Conformance vectors

The pure-JWS cases of the former links vector set (exact-bytes verification, noncanonical base64url, padding, signature length) test this profile. They move here when the vector file is split (contacts spike CR-LK2, pending with the code phase); until then they are in [bindle-links.vectors.json](../architecture/artefacts/bindle-links.vectors.json).

## 6. Change log

- 2026-10-27: created from links §3.1 and §7.2 (contacts and links spike CL-2, CR-K1; provisional, unsigned). References to "links §3.1" in signaling, identity portability, Bindle Messaging, intents and organizations now point here (CR-K2).
- 2026-10-28: identity portability revision 4 replaces the move statement and attestation with the provider-signed move record and acceptance (rows proposed, AMD-P5); recovery files no longer carry identity keys (recovery file v3, owner-approved). Provisional, unsigned.
- 2026-10-28: Organizations AMD-O7 rows merged; the link-meta row points to the Organizations annex; the link-data row is dropped (contacts and links spike CR-LK1, CR-LK2, CR-O1; provisional, unsigned).
