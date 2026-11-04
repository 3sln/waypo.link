# OIDC peer-signaling extension

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Metadata member: `waypo_signaling`. Supported version: `"1"`. The extension enables explicit peer connection setup without requiring synchronized storage, notifications, account selection or action approval. Applications retain their file-transfer, media, casting, agent-command and controller-trust protocols.

```json
{
  "waypo_signaling": {
    "version": "1",
    "endpoint": "https://identity.example/peer-setup",
    "scopes": ["signaling:read", "signaling:write"],
    "rendezvous": {
      "version": "1",
      "endpoint": "https://identity.example/app-rooms"
    },
    "federation": {
      "protocol": "waypo-signaling-v1",
      "endpoint": "https://identity.example/provider-signaling",
      "jwks_uri": "https://identity.example/provider-signaling-keys"
    }
  }
}
```

Only the first three fields describe base app-facing signaling. `rendezvous` and `federation` are independently optional signaling profiles. Omit a profile that is not supported. Federation metadata describes the existing explicit-invitation protocol; it does not make same-provider rooms federated.

The app-facing base implements expiring, app-bound invitations, recipient acceptance, bounded SDP/ICE messages, directional acknowledgments and closure. Discovery of invitation state does not provide a public directory of people or devices. An invitation ID or room ID alone is not authentication. The sender’s provider verifies its current app/user authority; the recipient’s provider verifies its recipient capability and admission before carrying setup messages. Providers must bound message bytes, lifetime, replay state and work.

The [participants and rooms contract](../implementation/rendezvous.md) defines the optional rendezvous profile. An individually credentialed participant advertises only within its authorized app/account scope; room membership requires explicit admission. Roles and metadata are untrusted app descriptions, not server privileges. Ephemeral browser presence and persistent installation identity have different retention. The current new-room implementation is same-provider only.

A federation sender resolves the recipient’s exact issuer-derived OIDC configuration and reads this extension’s `federation` descriptor. Purpose-specific ES256 keys at `jwks_uri` are separate from OIDC identity-token keys. The reference resolver rejects reuse of the OIDC key-set URI; operators must also keep the actual purpose keys distinct, since different URLs alone do not establish cryptographic separation. The signed envelope binds exact audience/target, purpose, request method, body hash, bounded times and a replay nonce. Invitation admission precedes attacker-selected provider/key discovery. Cache, refresh, negative-cache and pending-work limits apply; redirects and unreviewed network destinations are refused. New provider origins do not imply a provider-registration marketplace.

The provider carries setup messages, not file or media bytes. Already established WebRTC connections are independent of later signaling availability or revocation; applications must enforce their own session/command permissions and disconnect policy. Public NAT traversal, TURN bandwidth and television compatibility require separate configuration and evidence. No WebRTC signaling standard or cloud relay compatibility is claimed by the Waypo-specific protocol name.

Provider-authentication and app consent use ordinary OAuth/OIDC. Service scopes do not expose the provider browser cookie. The metadata has no participant inventory, private presence, account grant or entitlement data. The reference implementation’s budgets, caches, per-account limits and actor layout are not requirements on another implementation’s internal architecture.
