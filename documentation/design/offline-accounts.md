# Offline saved-account selection

This optional Waypo UI extension selects app-owned local data. It does not issue an OIDC authorization code, token, session, subject, role, or fresh identity proof. New sign-ins and newly connected apps use the existing online OIDC flow.

The provider publishes `account_selection` version `1` in optional service discovery, with a same-origin `selection_endpoint` and `binding: "online-consent"`. `/account-select` is the reference endpoint, not a path apps may assume for arbitrary OIDC providers. Issuers are compared exactly, including an issuer path.

After actual online consent, the provider service worker can retain a public binding of issuer, client ID, client display name and registered return URIs. Its authenticated binding endpoint checks current native consent and returns no user identifiers or credentials. The provider never persists the app's saved account labels or selection choices. The app retains its previously verified issuer/subject/client contexts and separate local stores and outboxes.

## Navigation contract

The app records a one-use pending local transaction before submitting a top-level form to the discovered endpoint. This works with COOP isolation and requires no opener. The action fragment is `waypo_request=<requestId>`. The only URL-encoded field is `selection_request`, containing base64url UTF-8 JSON:

```json
{
  "type": "waypo:offline_selection_request:v1",
  "requestId": "<32 random bytes, base64url>",
  "issuer": "<exact verified issuer>",
  "clientId": "<verified client ID>",
  "returnUri": "<dedicated registered app return URI>",
  "expiresAt": 0,
  "choices": [{"contextId": "<app-local opaque ID>", "label": "<app-saved label>"}],
  "activeContextId": "<optional choice ID>"
}
```

The worker checks the browser's Origin header against the registered return origin, the exact cached public binding, and the original expiration. It associates the volatile packet with the navigation's resulting browser client ID. The loaded public shell takes that packet once through a MessageChannel, checking its actual source client ID, provider URL and request nonce. Unknown clients, expired packets and worker restarts return no choice. The app can retry without losing local data.

The selected return URI receives only a fragment named `waypo_selection` containing base64url JSON with type `waypo:offline_selection:v1`, requestId, issuer, clientId, returnUri and contextId. Cancellation uses `waypo:offline_selection_cancelled:v1` without contextId. The app atomically consumes its own pending nonce and exact choice whitelist; this fragment must never enter OAuth callback handling or establish server permission.

## Reference implementation bounds

The current policy accepts at most 16 KiB per form, eight choices, 80 characters per label, 64 per context ID and two minutes per request. Pending provider packets are memory-only, with global and per-client bounds. Public client bindings are bounded independently. These are reference cache/admission policies, not protocol scale guarantees.

The existing root push service worker also serves this public shell. Its explicit asset allowlist excludes API, authentication, token, credential and personalized HTML responses. Ordinary provider entry navigation can fall back to the public chooser; it cannot show a cached authenticated dashboard. No signing key, session bearer, recovery material or app outbox is stored in this cache. Existing push delivery remains a separate regression gate.

An app must keep local context presentation distinct from current server authority. Offline selection preserves each account's isolated work; reconnect checks the exact selected account against its server session and current grant before forwarding. An explicit denial stops network publication without deleting local edits.

Baseline FedCM does not provide this offline mechanism: its account and assertion fetch algorithms set service-workers mode to `none`. The optional online enhancement remains separate. See the [FedCM specification](https://w3c-fedid.github.io/FedCM/) and [FedCM design packet](fedcm.md).

## Referrer policy and browser Origin

The handoff requires a nonopaque browser `Origin` on the cross-origin POST. Actual Chromium testing showed that a source document with `Referrer-Policy: no-referrer` sends `Origin: null` for this navigation. The provider rejects that request even when the payload names a known app. Payload fields, Referer, and remembered binding data cannot substitute for the browser Origin.

The supported handoff source uses `Referrer-Policy: strict-origin`, which reveals only the app origin, not its path or query. Integrators wishing to keep `no-referrer` on their ordinary application can use a dedicated, cached app-origin start/return document with `strict-origin` for this one local-selection flow. Its pending nonce and context whitelist still belong to the app and must be consumed once. Unknown or opaque origins fail with a generic retry message and no selection; app data and local accounts remain intact. This is an integration constraint, not an exception to exact-origin validation.
