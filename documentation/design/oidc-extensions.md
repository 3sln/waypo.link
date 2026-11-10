# Independent optional OIDC extensions

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Implementation direction approved 2026-11-04. This page is a navigation and integration guide, not an umbrella capability protocol. Each capability below defines its own optional OIDC metadata extension and can be implemented without the others. Ordinary OIDC identity providers remain usable for identity login.

| Capability | OIDC metadata member | Contract |
| --- | --- | --- |
| App notifications | `waypo_notifications` | [Notifications extension](notifications-extension.md) |
| App-private files | `waypo_blobs` | [Blob storage extension](blob-storage-extension.md) |
| App-private synchronized state | `waypo_sync` | [Synchronization extension](sync-extension.md) |
| Peer connection setup | `waypo_signaling` | [Signaling extension](signaling-extension.md) |
| Provider-owned account selection | `waypo_account_selection` | [Account-selection extension](account-selection-extension.md) |
| User-verified action approval | `waypo_action_approval` | [Action-approval extension](action-approval-extension.md) |

These are documented Waypo extension names, not claims of IANA registration or an existing general notification standard. They introduce no dependency on the hosted Waypo.link service, billing vendor, administration model, library or other optional extension. The reference implementation may require related modules to implement a particular operation; it advertises only what its actual composed ports support.

OIDC Discovery permits additional provider metadata. Providers advertise the supported extension objects in their normal OIDC configuration response. There is no separate custom services-discovery endpoint, enclosing `waypo` object, shared feature registry or aggregate services protocol. Clients must first validate the exact selected issuer and ordinary OIDC configuration before using extension metadata. A claimed capability is not consent, account entitlement or authority.

For example, this provider supports notifications but no other optional capability:

```json
{
  "issuer": "https://identity.example/issuer",
  "authorization_endpoint": "https://identity.example/authorize",
  "token_endpoint": "https://identity.example/token",
  "jwks_uri": "https://identity.example/keys",
  "waypo_notifications": {
    "version": "1",
    "endpoint": "https://identity.example/app-messages",
    "scopes": ["notifications:read", "notifications:write"]
  }
}
```

Clients ignore unsupported extension versions individually. A malformed known extension disables that capability; it does not disable valid sibling capabilities or identity login. Global issuer mismatch or malformed/oversized OIDC metadata is a discovery failure. Missing optional capabilities never authorize endpoint guessing or automatic scope expansion. An app can explain an unavailable required feature or continue with its own supported local/identity-only behavior.

The public response contains provider capability descriptions, never private account existence, devices, room presence, grants, usage or plan state. Authentication and current authorization remain necessary at resource access and delayed publication. A provider may advertise an operation that a particular account is not entitled to use.

The reference parser bounds the entire metadata response to64KiB, rejects redirects, preserves exact issuer identity, projects recognized fields and restricts service URLs to canonical URLs on the issuer’s origin. Its same-origin deployment restriction is an implementation/profile choice; general OIDC does not require every standard endpoint to share an origin. Independent providers need a reviewed audience and transport contract before introducing other origins.

OIDC issuer paths remain significant. Given `https://identity.example/issuer`, OIDC discovery is at `/issuer/.well-known/openid-configuration`. A domain-level convenience alias can help a person select a provider but must resolve to, and validate, the canonical issuer before authentication. This migration does not change an established issuer or merge accounts.

Other standards retain their own required routes: adding OIDC extension fields cannot replace browser FedCM discovery or an OAuth metadata location a provider claims to support. App-published Client ID Metadata Documents describe the app, not the provider’s services.

Sources: [OIDC provider metadata and extension allowance](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata), [OIDC configuration response](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationResponse), [OIDC issuer validation](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation).

Current source implements the metadata migration; new Node/Worker browser and independent-provider conformance evidence remain qualification gates. Older discovery captures prove their historical source only. Production release remains disabled.
