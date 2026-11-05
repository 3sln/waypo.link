# Integrating an application

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Waypo provides an OIDC identity issuer and optional app-scoped personal services. An app does not need a Waypo.link account, a shared client secret or manual registration with each provider. This guide describes the current reference profile; the implementation and release evidence remains in [the completion map](plan.md). The package is not published yet.

## The user's flow

1. The app shows a provider chooser. Its default is “Continue with Waypo.link”; an app can replace that provider and label. An app-supplied `knownProvider` takes precedence over the configured provider or default. The chooser does not persist that choice itself. Merely mounting the chooser makes no provider request.
2. On the user's action, the app starts its OIDC flow with the selected issuer. Login and consent happen on the provider's own page, where the app cannot inspect passkeys, email credentials or the provider session.
3. The provider returns a short-lived code to an exact app callback. The app validates its transaction, exchanges the code with S256 PKCE and verifies the signed identity token. The account key is the exact `(issuer, subject)` pair; email is not an account-merging key.
4. The app creates its own session. Optional storage, notifications or signaling work only when discovered, consented and currently allowed. An identity-only provider remains usable for login.
5. “Sign out of this app” clears the app session. Provider account management opens a separate provider-owned page. Provider logout and revoking a particular app's background grant are distinct actions.

The reference samples use top-level redirects and a backend for frontend. This avoids dependence on third-party iframe cookies or storage. FedCM remains a separate implementation item; the chooser does not imply that it is supported.

## Embed the chooser and account menu

Bundle these public exports with the app:

```js
import {mountProviderChoice, mountAccountMenu} from '@3sln/waypo/ui';

const chooser = mountProviderChoice(document.querySelector('#login'), {
  onContinue: ({issuer}) => beginOidcLogin(issuer),
});

// After the app has independently verified its login:
const menu = mountAccountMenu(document.querySelector('#account'), {
  provider: {issuer: verifiedSession.issuer, label: providerDisplayName},
  accountLabel: 'Your account',
  accountUrl: trustedProviderAccountUrl,
  onAppSignOut: () => clearAppSession(),
});

// In the host framework's unmount callback:
chooser.dispose();
menu.dispose();
```

`beginOidcLogin`, `verifiedSession`, `providerDisplayName`, `trustedProviderAccountUrl` and `clearAppSession` are application-owned code/data, not Waypo SDK methods. The UI does not verify identity, fetch metadata, retain tokens or implement logout for the embedder. Use an OIDC client appropriate to the app's deployment.

Both mount handles provide `update(configuration)` and `dispose()`. An update supplies the complete new configuration, including callbacks; it does not merge partial options. React/Vue integrations can mount and dispose within their ordinary component lifecycle without importing Waypo's internal renderer. Treat provider labels and URLs as display/configuration data, not authorization evidence. Preserve the exact selected issuer string, including its path and trailing-slash distinction.

## Registrationless client metadata

The client ID is an HTTPS URL controlled by the app, serving its client metadata document. Include the exact client ID, callback URLs, supported grant/response types, authentication method and a recognizable app name. The generic reference client omits optional scope metadata and separately filters requested scopes against discovered provider capabilities; it does not advertise every optional service scope as a login prerequisite. The samples publish this document at `/client.json`; that path is a sample convention. Public metadata can be cached; authentication responses, callbacks, tokens and user pages must not inherit that public cache policy.

The provider validates metadata through its bounded public-network transport. Changing a document does not silently expand a user's old consent. This is a versioned CIMD profile, and availability depends on the provider's configured safe transport; neither a localhost fixture nor a populated URL proves Internet interoperability.

The application must bind each pending login to its initiating browser/session, selected issuer, exact callback, nonce and one-use state, and keep the PKCE verifier private. Reject unsolicited, expired, reused and wrong-browser callbacks. Verify signature, issuer, audience, nonce and subject with a maintained OIDC library before creating an app session. Protect token-bearing server sessions and state-changing app routes; never accept a browser's claimed subject as authentication.

The independent sample server (in the Waypo source repository) shows the actual flow and negative-path seams. Its fixed A/B provider chooser, loopback transport, in-process session maps and test cookies are harness choices, not a production application template. Production web apps need HTTPS Secure cookies and durable/session-expiry policy appropriate to their own deployment.

## Optional services and synchronization

After verifying the selected OIDC issuer, use the public discovery helpers in `@3sln/waypo/sdk/discovery`. The [independent OIDC extensions](../design/oidc-extensions.md) describe each capability’s own metadata, endpoints and authority rules. There is no separate services-discovery request or aggregate capability protocol. Request only services the app understands. A missing feature, refused scope or expired plan should produce a useful identity-only or local-only state.

For background operations, request the relevant consent and renewable authority rather than depending on the provider's browser cookie. Keep tokens within their intended app/account boundary. A backend proxy should expose only discovered operations, validate its own CSRF boundary and reject stale account-context requests before forwarding them. Switching accounts in another tab must never send the previous account's queued edits using the new account's credentials.

`@3sln/waypo/sdk/sync` supplies structural Yjs document synchronization; `@3sln/waypo/sdk/indexeddb` supplies its browser persistence adapter. The Notebook browser (in the Waypo source repository) demonstrates real IndexedDB, text editing, offline persistence, quota/recovery states, private attachments and account-bound transport. Generic map/array/text transaction support is exercised separately by the SDK engine tests. The `transport` methods are injected: the SDK does not assume every app should expose bearer tokens to browser JavaScript. Use a namespace containing the verified issuer, subject and client ID, preserve local data on failed synchronization, and present quota/backoff/recovery states accurately.

Storage subscriptions are invalidation hints, not document content or authorization. The optional `@3sln/waypo/sdk/subscriptions` helpers support the discovered short-lived ticket profile; authoritative reads/writes still use current app authority. Configure CSP for the exact discovered HTTPS/WSS endpoints and coordinate same-device tabs where supported. Provider policy and the app's local persistence limits remain separate from the wire protocol.


## Protected notification actions

Read `waypo_action_approval` as an independent optional object in the validated OIDC provider configuration, not a child of notification metadata or a universal OIDC feature. The SDK projects this independent capability as `features.action_approval`; that in-memory SDK view is not another wire discovery protocol. See the [action-approval extension](../design/action-approval-extension.md). The configured reference descriptor includes `{version:'1', verification:'required', approval_profile:'waypo-action-approval-v1', jwks_uri: purposeKeyUrl}`; that key URL is independently advertised and must differ from the identity-token key location. Absence or mismatch fails closed for protected descriptors while ordinary identity and supported link notifications remain available.

The provider-owned confirmation page shows the exact app and ordered fields, requires a fresh action-bound passkey assertion, and submits the short-lived proof directly to the app from foreground UI. No broad app bearer is retained solely for approval. The receiving app must anchor verification to its already authenticated expected issuer, app-specific subject and stored action, validate purpose-specific discovery/keys and the exact binding, then atomically apply idempotency and its own authorization. A provider attestation is not independent proof that an untrusted provider performed UV. See the [approval core contract](action-approval-core.md).

The reference helper omits credentials, rejects redirects and does not retry uncertain submissions. Only a validated successful result can offer an explicit app-owned new-tab link; owner changes discard private results. An already published proof remains a short-lived capability, not an instantly revocable server session. Node and native Worker browser gates cover the configured reference path; production and the next hosted/core compatibility-pin check remain pending.


Offline account presentation is app-owned. The optional account-selection extension can return a previously verified local context through `onChooseSavedAccounts`; mounting the provider chooser does not persist identities or authenticate a new account offline. Keep cached contexts and outboxes isolated by verified issuer, subject and client. See [offline accounts](../design/offline-accounts.md) for the service-worker handoff and reconnect checks.


Treat HTTP429 as temporary backpressure, not logout or evidence that an identity is invalid. Preserve the verified local account context and queued work, stop service effects until authority can be revalidated, and honor Retry-After (including the maintained provider’s X-Retry-After) across focus/online wakes. The reference native session-read limiter currently permits one hundred accepted calls per path/trusted-peer bucket before requiring a ten-second quiet interval. Accepted calls update that interval, so this is not a one-hundred-calls-per-wall-clock-window allowance. NAT clients or an unavailable trusted peer address can share a bucket. These are implementation admission limits, not protocol semantics or a commercial capacity guarantee.

### Identity without optional app services

The provider consent page can offer **Continue with sign-in only** when the original request includes `openid` and optional scopes. That choice intersects the original scopes with `openid profile email`, removes background refresh and service scopes, and explicitly omits extra requested UserInfo claim names. The original signed authorization query, state, nonce and PKCE binding remain unchanged. Full **Allow** preserves the original request. Applications must inspect the returned scopes and support a reduced grant rather than assume service access or refresh authority.

Scope-derived profile/email disclosures still apply. Original ID-token sign-in requirements, including essential `acr`, remain enforced by the maintained provider. The reduced choice is withheld for resource profiles or essential explicit claims it cannot promise to honor; full approval and decline remain available. Permission approval does not purchase capacity or override account policy. A provider settings link opens separately and never automatically submits consent after returning.

`GET /api/waypo/service-status` supplies bounded, owner-session-only presentation with `Cache-Control: no-store`. Its capacity and permission flags come from core policy. The optional provider extension can describe existing account funding and terms, but that description never grants authority. An unavailable status read leaves the cached signed-in identity intact. The endpoint exposes no billing customer/subscription identifiers or payment details and is not a client funding API.
