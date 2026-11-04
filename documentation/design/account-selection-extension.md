# OIDC provider-owned account-selection extension

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Metadata member: `waypo_account_selection`. Supported version: `"1"`. This optional UI handoff is independent of synchronization, notifications, signaling and action approval.

```json
{
  "waypo_account_selection": {
    "version": "1",
    "selection_endpoint": "https://identity.example/choose-account",
    "binding": "online-consent"
  }
}
```

`selection_endpoint` identifies provider-owned account selection; it does not expose the account list to an embedding app. `binding` describes the implemented handoff profile. A client uses only a known profile, validates the endpoint against its selected provider and retains the authentication transaction’s app, issuer and destination binding. The provider’s private cookie, account inventory, passkeys and recovery material never become embedder credentials.

The [offline account-selection design](offline-accounts.md) distinguishes locally remembered identity from current online authority. Offline selection may choose an identity already known to the app; it cannot mint fresh provider authority, expand a grant or prove a revoked credential remains valid. Provider/network unavailability alone must not sign an existing offline-capable app out or erase local state. On reconnection, operations check current authority before publishing effects.

The extension is not FedCM and does not replace browser-mandated FedCM discovery or permissions. Browser popup/redirect, origin validation, service-worker caching, storage partitioning and offline handoff require their own implementation tests. An advertised endpoint does not prove all browser combinations or offline reopen behavior.

The reference implementation accepts a canonical same-origin endpoint and publishes no account identities in the OIDC document. Timing, local cache layout and UI toolkit are implementation decisions. The binding value cannot be silently reinterpreted as a fresh authentication or passkey proof.
