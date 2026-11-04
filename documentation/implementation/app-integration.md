# Integrating an application

> **Status:** Development documentation. Production release remains disabled.

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

After verifying the selected OIDC issuer, use the public discovery helpers in `@3sln/waypo/sdk/discovery`. The [service profile](../design/service-discovery.md) defines the exact discovery document, endpoint validation and scope rules. Request only services the app understands. A missing feature, refused scope or expired plan should produce a useful identity-only or local-only state.

For background operations, request the relevant consent and renewable authority rather than depending on the provider's browser cookie. Keep tokens within their intended app/account boundary. A backend proxy should expose only discovered operations, validate its own CSRF boundary and reject stale account-context requests before forwarding them. Switching accounts in another tab must never send the previous account's queued edits using the new account's credentials.

`@3sln/waypo/sdk/sync` supplies structural Yjs document synchronization; `@3sln/waypo/sdk/indexeddb` supplies its browser persistence adapter. The Notebook browser (in the Waypo source repository) demonstrates real IndexedDB, text editing, offline persistence, quota/recovery states, private attachments and account-bound transport. Generic map/array/text transaction support is exercised separately by the SDK engine tests. The `transport` methods are injected: the SDK does not assume every app should expose bearer tokens to browser JavaScript. Use a namespace containing the verified issuer, subject and client ID, preserve local data on failed synchronization, and present quota/backoff/recovery states accurately.

Storage subscriptions are invalidation hints, not document content or authorization. The optional `@3sln/waypo/sdk/subscriptions` helpers support the discovered short-lived ticket profile; authoritative reads/writes still use current app authority. Configure CSP for the exact discovered HTTPS/WSS endpoints and coordinate same-device tabs where supported. Provider policy and the app's local persistence limits remain separate from the wire protocol.


## Protected notification actions

Treat `notifications.protected_post` as an optional versioned capability, not a universal OIDC feature. The configured reference profile is `{version:'1', verification:'required', approval_profile:'waypo-action-approval-v1'}`. Absence or mismatch fails closed for protected descriptors while ordinary identity and supported link notifications remain available.

The provider-owned confirmation page shows the exact app and ordered fields, requires a fresh action-bound passkey assertion, and submits the short-lived proof directly to the app from foreground UI. No broad app bearer is retained solely for approval. The receiving app must anchor verification to its already authenticated expected issuer, app-specific subject and stored action, validate purpose-specific discovery/keys and the exact binding, then atomically apply idempotency and its own authorization. A provider attestation is not independent proof that an untrusted provider performed UV. See the [approval core contract](action-approval-core.md).

The reference helper omits credentials, rejects redirects and does not retry uncertain submissions. Only a validated successful result can offer an explicit app-owned new-tab link; owner changes discard private results. An already published proof remains a short-lived capability, not an instantly revocable server session. Node and native Worker browser gates cover the configured reference path; production and the next hosted/core compatibility-pin check remain pending.
