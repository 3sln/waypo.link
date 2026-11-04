# OIDC app-notifications extension

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Metadata member: `waypo_notifications`. Supported version: `"1"`. This optional extension is independent of synchronization, signaling, account selection and action approval. It describes an app-private user inbox and provider-controlled delivery, not a general public inbox or identity-security-event feed.

```json
{
  "waypo_notifications": {
    "version": "1",
    "endpoint": "https://identity.example/app-messages",
    "scopes": ["notifications:read", "notifications:write"]
  }
}
```

The object appears in a normally validated OIDC provider configuration. `endpoint` is the base of the notification resource API, not a Web Push subscription URL. Paths must be discovered, not assumed. `scopes` lists the authority vocabulary the provider supports; the app requests only what it understands and the user explicitly approves. A missing, unsupported or invalid object makes notification capability unavailable without affecting identity login or another extension.

The [notification contract](notifications.md) defines message content, recipients, app-owned destinations/actions, inbox searching and retention. The sending app may address its current app/account namespace only; it cannot choose another user’s inbox or supply arbitrary provider push destinations. Provider-owned settings decide delivery routes, preview privacy, rules, device selection and inbox retention. Enqueuing or accepting delivery does not prove external push receipt.

New resource operations require current app-bound OAuth authority, account/grant state and applicable budgets. Accepted delayed delivery must check the appropriate revocation and ownership state before publication. Browser sign-out is distinct from app disconnection and security revocation. Provider security/retention notices are a separate operator purpose and are not ordinary app-filterable messages.

Support for this extension does not imply support for user-verified action approvals. A provider advertises that separate capability with `waypo_action_approval` if implemented. The current reference implementation integrates those controls into notification messages, but there is no metadata requirement for another optional extension merely to advertise a provider’s implemented approval capability.

The reference implementation uses standard Web Push encryption and VAPID for configured browser delivery. That transport does not itself define this app inbox, routing policy, retention or OAuth API. CIBA callback metadata concerns authentication results and is not reused for arbitrary messages. W3C Linked Data Notifications defines a different JSON-LD inbox protocol; no LDN adapter is advertised or implied here. An independently implemented LDN or native delivery adapter would need its own declared contract and evidence.

Sources: [Web Push protocol](https://www.rfc-editor.org/rfc/rfc8030), [Web Push encryption](https://www.rfc-editor.org/rfc/rfc8291), [VAPID](https://www.rfc-editor.org/rfc/rfc8292), [Linked Data Notifications](https://www.w3.org/TR/ldn/).

Reference queue sizes, literal matching, codec/sanitizer choice and hosting price are implementation policy. Configured transport and protocol code do not establish external delivery or independent implementation conformance; those remain explicit evidence gates.
