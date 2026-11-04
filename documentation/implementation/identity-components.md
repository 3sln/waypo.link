# Identity component selection and protocol spike

> **Status:** Development documentation. Production release remains disabled.

Research/review: 2026-11-02, Codex security/browser subagent. Provisional engineering recommendation; no production approval. This document records actual package inspection and a local runnable experiment, separately from unverified platform claims.

## Recommendation

Use **Better Auth 1.7.15 plus its OAuth Provider 1.7.15** as the first candidate for one shared Node/Worker protocol implementation. Keep ngin as the Waypo admission, bootstrap, role, recovery and authorization policy boundary; inject the library as a protocol/authentication resource. Do not implement authorization-code exchange, ID-token signatures or WebAuthn verification ourselves. Candidate selection remains conditional on durable adapter atomicity, real browser credentials, expiry/revocation, and Worker validation.

The isolated spike pins `better-auth`, `@better-auth/oauth-provider`, `@better-auth/cimd`, and `@better-auth/passkey` to **1.7.15**, `@simplewebauthn/server` to **14.0.3**, and `jose` to **6.2.2**. Their installed package manifests declare MIT; the isolated lockfile pins transitive resolution. `npm install --ignore-scripts` reported zero known vulnerabilities on this date. This is registry audit evidence, not an independent security audit or absence-of-vulnerabilities guarantee. Root dependencies have not been changed.

| Component | Fit and limitation |
| --- | --- |
| Better Auth OAuth Provider | Actual installed Fetch handler performs code/S256 PKCE, consent, OIDC discovery and signed ID tokens; optional CIMD plugin discovers HTTPS clients. Native authentication/session/database model requires integration with Waypo policy, rather than silently becoming policy. |
| panva `oidc-provider` | Mature OpenID-certified Node implementation; current official sources document Node/Koa and experimental CIMD draft-02. Strong alternative for a Node-only deployment, but no verified portable Fetch/Worker implementation here. Choosing different provider implementations per adapter would increase conformance burden. |
| `oauth4webapi` | Low-level OAuth/OIDC **client**, useful for an independent relying party or future cross-provider client. It is not an authorization server replacement. |
| SimpleWebAuthn | Real registration/authentication verification used by the passkey plugin; direct use remains available where Waypo needs custom ceremonies. Browser success is not established by importing it. |

Primary sources: [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider), [CIMD](https://better-auth.com/docs/plugins/cimd), [panva provider](https://github.com/panva/node-oidc-provider), [oauth4webapi package purpose](https://github.com/panva/oauth4webapi/blob/main/package.json), [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server).

## Actual experiment

Run `npm ci --ignore-scripts` then `npm test` inside `spikes/identity-provider`. The spike uses a real Better Auth handler with SQLite, real one-time email-link credentials delivered to an injected local capture adapter, a discovered HTTPS client and an independently verified signed ID token. It never inserts an authenticated session or bypasses credential verification.

The passing test performs discovery; requests an email link; redeems the actual generated token; reads the resulting verified session; discovers a client from its exact HTTPS metadata URL; submits consent; exchanges a code with S256 PKCE; checks issuer/audience/nonce/signature using `jose`; and rejects code replay. It also checks that an unlisted redirect is not used and a public request without PKCE does not reach consent. The metadata transport is deliberately an in-process fixture returning a `.example` document; it proves library discovery behavior, not real DNS/TLS transport safety.

Executed on Node 24.6.0: one protocol scenario passed. SQLite is an in-memory database in this test. File persistence is configurable in the fixture but restart durability was not tested. No real email delivery, browser ceremony, Worker runtime, Google or Apple configuration was tested. No network server or production endpoint is exposed by this spike.

Installed API details matter: default issuer is **`https://identity.example/api/auth`**, including the base path. Mount `oauthProviderOpenIdConfigMetadata(auth)` at the appropriate top-level discovery route and validate discovery against the configured full issuer; do not infer issuer from request headers. Native handlers are under `/api/auth`; use discovered authorization/token/JWKS URLs. Consent submits `oauth_query` containing the entire signed query string received by the consent page, not an invented `oauth_query` URL parameter. Prefer the library's browser client plugin for that continuation once the real UI exists.

## Security integration requirements

**Passkey user verification:** installed `@better-auth/passkey` 1.7.15 calls SimpleWebAuthn with `requireUserVerification:false`. It exposes `registration.afterVerification` and `authentication.afterVerification`; source invokes these after cryptographic verification but before credential persistence/session creation. The spike configures hooks rejecting unless the corresponding verified `registrationInfo.userVerified` or `authenticationInfo.userVerified` is exactly `true`. This source-based integration must receive real browser positive and UV-absent negative tests before use. Setting browser options to `userVerification:'required'` alone is insufficient server enforcement. A fresh ordinary passkey session also does not establish administrator role, credential age or approval of a specific privileged operation.

**Closed admission:** the spike deliberately permits email-link account creation for a self-contained experiment. Production must not copy that default. Engine policy must gate every creation path, including magic link, unauthenticated passkey registration, social callbacks, import and API calls; unknown users cannot acquire an account because an upstream identity authenticated. Map the durable bootstrap-approved enrollment to the exact user/credential transaction and consume it atomically. Existing users must retain ordinary login when registration is closed.

**Email UX/security:** the library's stock magic-link verification is a GET endpoint using a query token. The spike uses it to exercise actual credentials; this is not approval of that route as Waypo's final email flow. Scanner-safe read-only landing, explicit approval, initiator/device binding, cross-device completion, token redaction and no third-party assets remain required. A route wrapper must not create an alternate unguarded GET redemption path. Do not send real credentials through the test mailbox outside isolated local testing.

**Atomicity/revocation:** persist library sessions, signing keys, codes and refresh families with real adapter transactions/atomic consumption. Verify concurrent code exchange and refresh rotation against the actual Node and Worker adapters. A published authorization-code race affected OAuth Provider versions before 1.6.11; this spike uses 1.7.15, but that history makes adapter-specific concurrency tests essential. Never equate successful upstream OIDC login with a local administrator role or resource grant. [Maintainer advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-7w99-5wm4-3g79)

**Public profile:** enable only needed grants/scopes, explicitly configure pairwise subject policy and stable secret, exact redirect checks, client metadata limits and app consent. Optional Google/Apple are disabled until operators configure and validate their actual credentials. Device grants, DPoP, logout, refresh and federation are not demonstrated by this one code-flow test.

## Node and Worker boundaries

Better Auth documents Workers' `nodejs_compat` requirement for AsyncLocalStorage. Its Fetch interface is promising, but this Node fixture imports `node:sqlite`; it is not a Worker bundle. Extract one shared library configuration factory accepting database/mailer/policy/metadata ports, then supply Node SQLite versus a proven Worker-compatible adapter. Verify SQL transaction/atomic consume semantics before selecting D1 or a Durable Object adapter. Do not hide a second implementation behind similarly named endpoints. [Installation](https://better-auth.com/docs/installation), [SQLite integration](https://better-auth.com/docs/adapters/sqlite)

**CIMD is a release blocker until safe transport exists on each runtime.** The installed Node subpath exports a transport that validates all DNS results and pins a public address while preserving TLS hostname identity. Official docs explicitly require Workers and other runtimes to provide equivalent secure transport. Ordinary `fetch()` plus a prior DNS lookup is not equivalent and can permit rebinding. Fail closed with discovery unavailable on an unproven Worker transport; a configured sample client may unblock early tests but does not satisfy final registrationless interoperability. Apply timeout, size, redirect, public-address and per-origin/global rate controls; review metadata changes without silently broadening existing grants. CIMD remains a versioned draft profile, not a blanket claim of OIDC certification.

## Next integration slice

Inject the real provider handler and verified identity/session projection into ngin; keep bootstrap and admission checks in shared engine actions. Have one Node adapter and one Worker adapter mount the same configured handler. Add actual passkey browser ceremonies and scanner-safe email completion before exposing an account UI. Then validate two independent provider instances and two independent relying-party apps, cookie/storage isolation, account switching, consent refusal, revocation and restart. Feature-specific cross-provider resource/signaling tests follow actual implementation; discovery success alone is not federation success.

Merge evidence remains ngin/core and focused adapter tests. Browser credential/DOM checks are required when implemented; the full two-provider/two-app E2E matrix is a prerelease/deployment gate. This spike does not replace that mandate.
