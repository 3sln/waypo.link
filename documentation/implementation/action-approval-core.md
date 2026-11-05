# Protected-action approval core

The portable approval core now has a configured reference-provider integration: fresh action-bound WebAuthn verification, purpose-separated signing keys, immutable recipient capture, a dedicated confirmation document, and foreground app submission. It remains disabled by default. This is not a provider-server POST proxy, and Waypo.link production activation remains disabled. The pure core tests use synthetic trusted ports; separate Node and native Worker browser gates exercise real signed passkey assertions and app verification.

An approval means the app's selected authenticated issuer attests that it verified fresh WebAuthn UV for the exact action digest. A malicious or compromised account provider can mint these proofs just as it can mint login assertions. Provider-neutral discovery removes manual per-provider setup; it does not remove inherent issuer trust or certify providers globally. An app requiring independent authenticator/provider assurance needs its own additional policy. The baseline makes no `acr`, biometric-only, device-provenance or certified-assurance claim. WebAuthn UV itself does not prove the person read or understood the action.

## Separate server entries

- `@3sln/waypo/action-approval/verifier`: canonical binding, expected-issuer discovery, pure verification and optional invocation ledger for app servers.
- `@3sln/waypo/action-approval/provider`: canonical binding, purpose metadata, internal ceremony port and ngin issuer for provider servers.

The combined source `index.mjs` is an internal test/development entry. Applications must derive expected issuer, app-specific subject and OAuth client ID from their authenticated server session or a prior server-trusted recipient/action record established under authenticated identity. Never obtain those trust anchors by decoding the approval JWT or accepting browser-supplied context. Browser preflight can aid UX but is not authoritative verification.

## Binding version 1

`canonicalizeActionBinding(binding)` clones the complete input before any asynchronous crypto, validates it, and returns frozen `{canonical,digest,binding}`. `canonical` is a fixed-order JSON array, encoded UTF-8 for SHA-256; `digest` is unpadded canonical base64url. This is a Waypo-defined canonical format, not RFC 8785/JCS. Serialization follows ECMAScript `JSON.stringify` for that fixed array: no insignificant whitespace, decimal integer numbers, required quote/backslash/control escapes (lowercase hexadecimal when a Unicode escape is required), no optional slash/ASCII escaping, and other well-formed Unicode encoded literally as UTF-8. A different JSON spelling of equal values is not the canonical byte sequence.

```js
{
  version: 1,
  issuer: 'https://id.example/api/auth',
  subject: 'subject_app_1',
  clientId: 'https://app.example/client.json',
  notificationId: 'notice_1',
  actionId: 'approve',
  actionVersion: 2,
  url: 'https://app.example/api/approve?order=42',
  method: 'POST',
  fields: [['order', '42'], ['label', 'Café'], ['tag', 'a'], ['tag', 'b']],
  actionNonce: 'nonce_123',
  actionExpiresAt: 1800000120000,
  authorizationTokenDigest: null,
  idempotencyKey: 'invoke_1',
}
```

The canonical sequence is `[purpose,1,issuer,subject,clientId,notificationId,actionId,actionVersion,url,"POST",fields,actionNonce,actionExpiresAt,tokenDigestOrNull,idempotencyKey]`, where purpose is `waypo-action-approval-v1`. The example's digest is `XwIVsfAsTlqb-3bZZ9xVw4xicCHCwxzb-ofDTkuios8`, independently cross-checked with a second SHA-256 implementation.

Fields are ordered string pairs; duplicates, order, exact whitespace and Unicode scalar sequences are significant. There is no Unicode normalization. Unpaired surrogate strings reject. Timestamps are positive integer UTC epoch milliseconds; action expiry is distinct from message deadline/retention. Unknown binding fields reject. An optional app authorization token is not required by the protocol: absent/null token digest has one explicit meaning. When an app does use such a token, it computes and compares the exact SHA-256 digest; the raw credential never appears in the proof.

Action URLs must be canonical public-syntax HTTPS, without credentials, fragments or nondefault ports. The core does no URL fetch and does not independently prove URL ownership, current app permissions, entity existence or business invariants. The provider's notification URL validator and the app's own expected endpoint/authorization policy remain necessary integration boundaries. The issuer identifier is preserved exactly, including a valid bare origin without an added slash.

Current engineering caps: 16 field pairs, 64 UTF-8 bytes/name, 1024/value, 4096 aggregate field bytes, 12288 canonical bytes, 8192 proof bytes and 120 seconds maximum proof lifetime/fresh ceremony age. These are versioned profile admission rules, not commercial entitlements.

## Issuance and real ceremony integration

`createActionApprovalIssuer({issuer,store,signingKey,kid,ceremonies,clock,random,crypto})` constructs the ngin issuer. Its internal `issue({binding,ceremonyReceiptId}, authenticatedContext)` accepts only an opaque receipt ID, not a public `userVerified` boolean or serialized receipt. Unknown public flags reject. Use a separate ES256 P-256 signing key and purpose-specific public key set; reusing OIDC signing material violates this integration contract even though the core cannot inspect the provider's entire OIDC key inventory.

`createInternalCeremonyReceiptPort({consumeStoredVerifiedReceipt})` is a trusted provider bootstrap interface. Its callback must use the supplied native transaction to consume a durable receipt produced only after real maintained WebAuthn verification of RP ID, origin, challenge, credential ownership and signed UV. That challenge must already bind the same action digest and app-specific identity. The receipt record contains exact purpose/receipt/issuer/subject/client/digest, `verification:'webauthn-uv'`, verifiedAtMs and expiresAtMs. A recent login receipt or another action's ceremony is insufficient.

WeakMap registration prevents a request object from impersonating this internal port. It is not independent evidence that an arbitrary callback actually verified WebAuthn. Trusted server code holding the signing key can lie; wiring the genuine ceremony adapter and independently testing that integration are mandatory before exposing issuance.

Receipt consumption and JOSE signing occur inside the same durable transaction; the proof is published only after successful commit. Failure rolls back consumption. Final expiry/freshness checks run after asynchronous signing. No network request belongs inside this transaction. The storage port must implement durable, isolated rollback semantics; an in-memory test store is not a deployment implementation.

The JWT uses only protected `alg:ES256`, `typ:waypo-action-approval+jwt`, and a bounded ASCII key ID. Claims bind exact iss/sub/aud, action digest, purpose/version, a unique server-generated jti, second-resolution iat/exp, and the provider-attested WebAuthn UV verification time. It is a purpose-specific approval token, not an ID token, reusable login assertion, raw authenticator assertion or provider session token.

## Expected-issuer discovery and pure verification

`createActionApprovalDiscovery({readJson})` uses only an injected safe public JSON transport; there is no global-fetch fallback. It reads the standard OIDC metadata URL formed by removing trailing slashes from the authenticated expected issuer and appending `/.well-known/openid-configuration`. For the example issuer that is `https://id.example/api/auth/.well-known/openid-configuration`. A bare-origin issuer uses `https://id.example/.well-known/openid-configuration`. There is no separate approval metadata endpoint or fallback.

The OIDC document must identify that exact issuer and contain canonical public HTTPS authorization, token and identity-key locations. The independent extension is:

```json
{
  "waypo_action_approval": {
    "version": "1",
    "verification": "required",
    "approval_profile": "waypo-action-approval-v1",
    "jwks_uri": "https://id.example/api/waypo/action-approval/jwks"
  }
}
```

Only that extension selects approval keys. A missing, malformed, unsupported or downgraded extension fails approval discovery; unrelated optional extensions are ignored. The purpose JWKS must be canonical HTTPS on the selected issuer's origin, without credentials, query or fragment, and its URI must differ from the OIDC document's identity `jwks_uri`. The resolver never fetches identity keys as an approval fallback. Distinct URIs do not independently prove that an operator chose distinct key material; separate approval signing material remains a provider integration requirement.

Discovery adapts the extension to the verifier's private in-memory descriptor `{version:1,issuer,purpose:'waypo-action-approval-v1',jwks_uri,algorithms:['ES256']}`. `actionApprovalMetadata` constructs that descriptor for trusted provider wiring or tests; it is not a discovery document or public metadata endpoint.

Purpose keys are public EC P-256 verification keys with unique kid, alg ES256, use sig and key_ops verify. Private material, key URL headers, embedded JWKs, extra protected JOSE headers and foreign purpose-JWKS origins reject. The injected transport must enforce actual public DNS/connection checks, redirect refusal, credential omission, a 64 KiB OIDC document cap, a 16 KiB purpose-key cap, five-second request/body timeouts and cache isolation. The private normalized descriptor remains bounded to 4 KiB. Passing ordinary arbitrary `fetch` does not establish those transport properties.

`createActionApprovalVerifier({discovery,clock,crypto}).verify({proof,expected,binding})` is pure with respect to replay state and app effects. It checks expected identity/binding, purpose/header/key/signature, required claims, exact string audience, short expiry and real-time UV freshness, including a final clock check after asynchronous work. The app must construct the binding from its trusted action definition and actual endpoint/method/submitted fields; blindly echoing a client-supplied binding/digest does not check the action being executed. It never discovers keys using unverified proof iss/jku/jwk fields. The returned claims/binding are deeply frozen and internally branded, so serialized/caller-constructed claims cannot enter the optional ledger without verification.

Expired JWTs reject. Looking up an already completed application result after proof expiry requires a separate authenticated app result route, scoped to the original recipient/action/idempotency record. It must not be implemented by accepting an expired approval JWT. Pure verification does not consume a proof or authorize a side effect by itself.

## Optional invocation ledger

`createApprovalInvocationLedger({store,clock,random,crypto,leaseMs,retentionMs,maxEntries,reconciliation})` separates replay coordination from signature verification. Defaults are a 30-second lease, seven-day completed-result retention and 256 entries per issuer/subject/client scope. Configurations are bounded. A claim binds the issuer/jti and the recipient/client/idempotency key to the exact digest. Different bindings under a reused proof or idempotency key conflict. Random lease secrets must come from a cryptographically secure server source.

`claimInvocation(verified)` returns `claimed` with a lease token/deadline, `pending`, `replayed` with the committed outcome, or `conflict`. Claiming is not executing. `completeInvocation(verified,leaseToken,outcome)` records a terminal succeeded/failed/cancelled outcome and at most 4096 JSON bytes after checking the lease. A timeout or network error does not establish failed/no-effect and must not automatically become a terminal failure.

The app should use `ledger.inTransaction(tx)` to commit its domain mutation and `completeInvocation` in the same actual app database transaction. Alternatively, the app must supply its own idempotent executor/reconciliation mechanism. A network side effect followed by an independent ledger write has an unavoidable crash gap; this helper makes no exactly-once claim for it. Do not hold the transaction across arbitrary network execution.

A pending lease that expires becomes indeterminate, with no automatic takeover, retry, deletion or capacity eviction. The original worker may already have applied a nontransactional effect. The app must stop/fence that worker and reconcile its real domain/external state before resolving the record. `reconcileIndeterminate({expected,idempotencyKey,digest,decision,evidenceId,outcome}, authenticatedOperator)` requires an injected trusted transactional `reconciliation.authorize` callback returning an auditable actor ID; caller-supplied true/authorized flags have no meaning. Without that policy port, reconciliation is unavailable.

Allowed decisions are confirmed-completed or confirmed-no-effect, with no-effect forbidden from claiming a succeeded result. The resolution records actor/evidence/time, becomes a terminal result and restarts bounded result retention. It does not release the old proof for execution or automatically restart the action. A retry is a new deliberate app operation/approval as the app's policy requires. Manual/staff reconciliation is part of the eventual app integration, not an authority provided by the approval core alone.

`collectCompleted(expectedContext)` removes expired completed entries and their proof-use references, in a scope bounded by maxEntries. Pending entries remain and count against capacity until reconciled; full capacity fails closed. Account terminal deletion must additionally fence app workers and remove all scoped ledger data under the app's deletion policy; the core does not install that account lifecycle hook. Retention expiry means the optional cache is bounded, not that domain idempotency/uniqueness requirements disappear. Apps requiring longer guarantees must persist them with the business state.

## Verification scope

The engine tests cover a golden canonical digest, async mutation resistance, real ES256 signing/verification, purpose/header/identity/key substitution, receipt rollback, expiry, concurrent replay claims, indeterminate lease handling, trusted reconciliation and atomic app-effect/result rollback. They use mocked trusted ceremony and transactional resources for policy isolation. Separate reference integration gates cover actual WebAuthn approval, UI, discovery and authenticated app submission on Node and native Workers. These local results do not establish production vendor readiness, every relying app’s authorization/idempotency correctness, or interoperability with arbitrary providers. Production release and the next hosted/core compatibility-pin validation remain pending.

The [JWT security BCP](https://www.rfc-editor.org/rfc/rfc8725.html) motivates explicit token typing and distinct validation/key trust for different JWT uses. [jose verification options](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md) provide the maintained issuer/audience/subject/type/algorithm checks. Those mechanisms do not standardize this proposed action protocol or certify its issuers.
