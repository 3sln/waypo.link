# Add Waypo to an app

Start with standard OpenID Connect sign-in. Add optional services only when your app needs them. Your frontend can use sync and signaling directly with properly scoped credentials; an app backend is not required for every integration.

## 1. Choose your provider and client library

Use a maintained OIDC client appropriate for your platform. The hosted issuer is `https://waypo.link/api/auth`; self-hosters have their own exact issuer. Retrieve its standard OIDC metadata and validate the issuer. Do not hard-code the hosted service into authority checks.

Waypo supports registration-free client identification through HTTPS client metadata where implemented. That does not mean arbitrary callback URLs are trusted. Publish the required client metadata on an origin you control, and follow the [integration contract](../implementation/app-integration.md) for redirect validation and supported client types.

## 2. Implement a complete sign-in flow

For browser apps, use authorization code with PKCE and validate state, nonce, issuer, audience, and callback binding through your OIDC library. Keep credentials out of URLs, logs, and untrusted embedding pages. A successful sign-in identifies an account; optional capabilities require their own scopes.

Use provider-owned account selection and permission UI where supported. Do not collect the user's provider password or passkey yourself. Device/CLI flows are separate supported flows, not a shortcut for weakening browser redirects.

## 3. Discover only the features you need

Optional features are advertised as independent OIDC metadata extensions. Check the [extension guide](../design/oidc-extensions.md), then read the individual contract for [sync](../design/sync-extension.md), [notifications](../design/notifications-extension.md), or [signaling](../design/signaling-extension.md). There is no mandatory umbrella discovery protocol.

For sync, use the generic document semantics rather than depending on the underlying CRDT engine. Attach large binary files separately. Handle quota pressure and provider retry instructions through the SDK rather than repeatedly retrying rejected writes.

For signaling, your app defines rooms, roles, pairing, and consent. Waypo helps authorized participants exchange connection setup messages; it does not provide a global directory or a media relay. See the [rendezvous implementation](../implementation/rendezvous.md).

## 4. Make denial and disconnection ordinary states

Your app should work clearly when a user declines a feature, reaches storage capacity, goes offline, or disconnects access. A cached account can label local data offline; it cannot authorize a remote operation without revalidation. Never turn temporary network failure into an unsolicited logout.

## 5. Test across providers

Use sample apps and two independently configured providers to exercise issuer binding, grants, revocation, and reconnect behavior. Source packages and test harnesses are in the [Waypo repository](https://github.com/3sln/waypo). This guide does not imply a published SDK release or production certification.

## Store files independently of synchronized state

Discover the optional [`waypo_blobs` extension](../design/blob-storage-extension.md) and request `blobs:read` and/or `blobs:write` only when the app needs them. New apps should use app-private blob keys for files; synchronized documents may contain those keys but are not required. A provider may offer files without CRDT state or state without files. Handle absent capability and declined permission.

The frontend `createBlobStorage` SDK uses your authenticated transport and conditional versions. Create a fresh key before publishing a document reference; those operations are not one transaction. Handle missing/changed keys and clean up files explicitly. A stored version is not a historical download pin. The reference currently buffers files up to4MiB; the [larger-file streaming plan](../design/blob-streaming-next.md) is provisional work, not implemented support.
