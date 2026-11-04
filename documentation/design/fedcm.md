# FedCM profile and browser integration

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

Research and proposed implementation direction, 2026-11-02. This is not implemented FedCM evidence. Standard OIDC redirects remain the baseline and must keep working when the optional browser feature is unavailable.

Chrome's provider integration requires discovery/configuration, account and assertion endpoints, login-status signaling and origin checks. Cross-site FedCM credential requests use `SameSite=None` cookies. Chrome 141 and later can describe an account without email; older versions require name and email. Never fabricate an address for passkey-only accounts. A provider on a subdomain also needs the prescribed site-level well-known document. These are deployment prerequisites, not app registration. [Chrome provider integration](https://developer.chrome.com/docs/identity/fedcm/implement/identity-provider).

An RP can pass custom parameters and use a user-initiated active flow. A provider continuation can collect additional consent in its own window before resolving the browser request. Feature detection, browser settings and explicit fallback remain necessary; one successful Chromium probe will not establish Safari/Firefox support. [Chrome relying-party integration](https://developer.chrome.com/docs/identity/fedcm/implement/relying-party).

FedCM transports an opaque provider result; it does not prescribe a replacement token format or validate that result for the app. Our proposed result therefore carries a one-use handoff to the existing OIDC code/PKCE flow, rather than introducing a second identity-signing implementation. [W3C FedCM specification](https://www.w3.org/TR/fedcm/).

## Proposed user and node flow

1. The user clicks the provider-neutral login component. No provider request is needed merely to render it. The app selects/verifies its issuer and checks whether the provider advertises the optional FedCM profile.
2. The app creates a normal state, nonce and PKCE transaction. Its FedCM request includes only a bounded transaction reference and public challenge parameters; the verifier stays with the app/BFF.
3. The browser presents the provider's eligible account. The provider verifies the browser request destination, selected account and actual RP origin against validated client metadata. For URL client IDs, use verified redirect origins, not an assumption that the metadata URL's host is the RP.
4. The initial conservative profile always continues into provider-owned UI. Existing authentication, optional-feature consent and billing gates execute there. No browser disclosure flag grants storage or notifications by itself.
5. The maintained OIDC implementation issues the normal code. A purpose-bound handoff returns only to the matching pending FedCM transaction through the continuation API. The app exchanges and verifies it normally. Neither a provider session cookie nor recovery state reaches the app.
6. Cancellation ends this attempt. Show a standard sign-in alternative; do not respond to dismissal by automatically opening another login window. Unsupported providers/browsers use the ordinary explicit redirect/popup path.

The exact handoff contract needs implementation and adversarial testing before advertising support. Bind issuer, RP origin, client, redirect, state, nonce, challenge, selected account and expiry; consume once. Account switching during continuation must be explicit, with the returned identity checked by the app.

## Cookie and hosting seam

Prefer retaining the current first-party session policy. A candidate narrowly scoped HttpOnly `SameSite=None; Secure` hint can identify eligible accounts to browser-owned UI, while granting no login, assertion, account mutation or data access. It must depend on a live underlying session and expire/revoke with it. The mandatory first-party continuation authenticates with the real session. This avoids globally relaxing every authentication cookie merely to list accounts; it needs actual browser validation and independent review.

Providers must configure the site-level well-known response at their legitimate host. A subdomain behind an independently managed apex may need a small static file there. Do not claim arbitrary Workers default hostnames support that prerequisite, bypass well-known verification with test flags, or turn the feature into a dependency for self-hosting.

## Evidence required

Use real browser FedCM dialogs and network requests. Chrome's DevTools protocol exposes FedCM dialog events and account selection controls, allowing automation without replacing `navigator.credentials.get`. [Chrome DevTools FedCM domain](https://chromedevtools.github.io/devtools-protocol/tot/FedCm/).

Verify no pre-click requests; legitimate site-level discovery; no-email accounts; account/RP/client mismatches; one-use handoff and PKCE; cancellation; unavailable-feature fallback; and absent third-party iframe storage. Keep required provider-consent and privileged-action checks in force. Capture browser/page evidence when requested, and state any browser-chrome screenshot limitation separately.

Reference-profile choice and optional-feature implementation, not a new core identity standard. Operator branding and Waypo.link billing remain outside this protocol seam.

## Offline account selection — 2026-11-03

Owner requirement: the provider-owned login/account chooser must be backed by a service worker, open while the provider/network is unreachable, and support switching among accounts already authenticated by the app. Network failure must preserve the remembered identity and isolated local work. Reconnection checks current app/account authority before sending queued changes; explicit rejection preserves the local copy and requests online authentication.

Baseline FedCM cannot be the offline dependency. The current editor's draft, dated October 21, explicitly bypasses service workers for its accounts and assertion fetches. A service worker controlling the ordinary provider page therefore does not intercept those browser-managed requests. [Current FedCM fetch algorithms](https://w3c-fedid.github.io/FedCM/).

The Identity Handler proposal would provide an explicit provider service-worker hook for credentialed FedCM endpoints, including locally served responses. It remains experimental: Chromium's current feature declaration disables `kFedCmIdentityHandler` by default. This is useful future spike work, not shipped cross-browser assurance. [Identity Handler proposal](https://github.com/w3c-fedid/identity-handler), [Chromium feature declaration](https://chromium.googlesource.com/chromium/src/+/refs/heads/master/content/public/common/content_features.cc).

Implement the offline chooser independently of FedCM: public cached shell/assets, minimal account-choice data and a purpose-bound local selection result for an already-known app context. Preserve exact requesting origin/source/transaction bindings and account namespaces. App-supplied remembered choices must be identified as such; they do not establish fresh provider authentication. Server session bearers, token endpoints, recovery secrets and personalized API responses must stay out of generic service-worker caches. Online login retains the maintained OIDC flow. Fresh privileged actions require current verified authority. The existing push service worker and its confirmed-contact enrollment must continue to work across updates.

Implementation and real service-worker navigation/reopen evidence are pending. Existing CRDT offline tests and session-privacy browser passes do not establish this new capability. The app may surface its own accurate sync/signaling status; an offline indication alone does not prove an established peer connection has stopped working.
