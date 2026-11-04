# OIDC user-verified action-approval extension

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Metadata member: `waypo_action_approval`. Supported version: `"1"`. This extension independently declares support for a provider-authenticated user-verification proof profile. It does not require synchronized storage or signaling. Another optional extension is not a metadata prerequisite.

```json
{
  "waypo_action_approval": {
    "version": "1",
    "verification": "required",
    "approval_profile": "waypo-action-approval-v1",
    "jwks_uri": "https://identity.example/api/waypo/action-approval/jwks"
  }
}
```

A client uses this object only after validating normal OIDC provider metadata at the exact authenticated issuer's standard `/.well-known/openid-configuration` location. This extension has no additional metadata document or well-known endpoint. `verification` cannot be downgraded to an optional browser assertion. `approval_profile` identifies the proof/verification contract implemented by the provider; no arbitrary substitute profile is inferred. A missing or unsupported object means the client cannot offer this protected action with the claimed verification guarantee.

The reference application currently supplies the profile through protected notification actions; that composition relationship is an implementation choice and it publishes the descriptor only when its actual approval port is available. It does not claim a standalone general approval API merely because this metadata name exists. Application destination URLs for an action are supplied by that action’s validated transaction/binding, not guessed from the metadata or freely replaced by the embedder.

The [protected-action design](notifications.md) and [verification implementation](../implementation/action-approval-core.md) describe exact action binding, provider-owned verification, audience, expiry, one-use/replay and app-owned destination checks. A browser cannot claim verification by setting a flag. The receiving app must verify the provider’s proof for the exact intended action and user/provider context; it need not pre-register every provider signing key manually. A discovered identity issuer or familiar logo is not itself a valid action proof.

The document advertises capability only. It contains neither a user verification result nor an account’s action history, credentials or privilege grants. Native verification, independent receiving-app interoperability and the applicable browser UI must be demonstrated separately; discovery metadata is not conformance evidence.

The extension's required `jwks_uri` selects the public verification keys for this approval purpose. It must be a canonical HTTPS URI on the selected issuer's origin, without credentials, query or fragment, and differ from the standard OIDC `jwks_uri` for identity signing keys. The reference provider publishes purpose keys at `/api/waypo/action-approval/jwks`; consumers follow the advertised URI rather than guessing this implementation path. A missing key location is an unavailable approval capability, not permission to use identity keys.

The receiving app's approval resolver fetches only the standard OIDC document (at most 64 KiB) and that purpose key set (at most 16 KiB), with five-second bounded safe-public transport, no cookies or redirects. Proof format, expected identity, action binding, ES256 algorithm and purpose remain the fixed `waypo-action-approval-v1` profile. No JWT `iss`, `jku` or embedded `jwk` chooses the expected provider or its key location. Other optional extensions do not become prerequisites for approval verification.
