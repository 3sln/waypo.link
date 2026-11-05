# OIDC app-private synchronization extension

> **Status:** Development contract for the in-progress OIDC metadata migration. The hosted reference-package pin has not been advanced; this page does not claim deployed support. Production release remains disabled.

Metadata member: `waypo_sync`. Supported version: `"1"`. It describes synchronized app-private documents and their optional attachment/invalidation profiles. Notifications, signaling, provider account selection and action approval are not required.

```json
{
  "waypo_sync": {
    "version": "1",
    "documents_endpoint": "https://identity.example/private-documents",
    "codecs": ["yjs-update-v1"],
    "scopes": ["sync:read", "sync:write"]
  }
}
```

Clients first validate the selected provider’s ordinary OIDC metadata, then inspect this optional object. `documents_endpoint` is an opaque resource base; do not infer a route from a provider brand or issuer path. `codecs` advertises supported wire data encodings. The generic SDK’s state semantics are described separately in [synchronized-state semantics](sync-semantics.md); discovering a codec is not permission to change those public semantics.

App/account namespaces derive from verified OAuth authority. A caller cannot choose another account through request fields, a document ID, room role or an origin prefix. Changing accounts separates local replicas/outboxes and pending uploads. Requests and delayed publication check applicable live authority and revocation. Temporary provider pressure, storage exhaustion, ended access and stale document epochs must be distinguishable; temporary unavailability must not discard local edits.

The optional attachment operations in the current reference document profile are advertised by `attachments:read` / `attachments:write` scopes. They are document-linked resources, not an implied standalone public object-storage service. Apps keep large blob bytes outside structural CRDT state. Metadata does not promise a particular account allowance, free tier, file limit or storage price.

Omit unsupported optional subprofiles. The reference implementation uses Yjs’s advertised versioned encoding; other implementations may use a supported compatible codec without reproducing its internal actor, database, cache or snapshot arrangement. No codec interchangeability or migration guarantee is inferred merely from the JSON document.

## Optional storage invalidation channel

The reference profile can advertise this additional object inside `waypo_sync`:

```json
{
  "subscriptions": {
    "version": "1",
    "protocol": "waypo-sync-v1",
    "ticket_endpoint": "https://identity.example/opaque/storage-ticket",
    "endpoint": "https://identity.example/opaque/storage-channel"
  }
}
```

Both URLs follow the same selected-issuer origin and canonical-HTTPS rules as the other service endpoints. Paths are opaque. Omit this object when unavailable; an unknown version leaves HTTP synchronization usable. This channel requires current `sync:read` authority. Notification-only clients do not need a paid storage capability merely to read their inbox.

The client posts to the discovered ticket endpoint with its app-bound OAuth authority and exact browser Origin. The provider checks live authority and issues `{ticket, expiresAt}`. The ticket is short-lived, single-use and bound to that Origin and immutable app/account/device authority. It is not an account login credential. In this reference wire profile its opaque syntax is 64 lowercase hex characters, a dot and 16–128 URL-safe characters; clients must not interpret the routing prefix as a portable identity. Providers must use unguessable secrets.

The browser changes only the channel endpoint's scheme from HTTPS to WSS and opens a WebSocket offering two subprotocol values: `waypo-sync-v1` and `waypo-ticket.<ticket>`. Neither an OAuth bearer token nor a query-string credential is used. The server consumes the ticket under the exact Origin and negotiates only `waypo-sync-v1`. Reconnect obtains a fresh ticket through ordinary current OAuth authorization. Tickets expire after at most ten seconds and reference connections after at most fifteen minutes. The SDK bounds handshake waiting and uses HTTP fallback when a channel is unavailable.

An initial or later frame is an invalidation hint, for example:

```json
{
  "type": "invalidate",
  "sequence": 12,
  "resync": true,
  "documents": [{"documentId": "notes", "epoch": "opaque-epoch", "revision": 4}]
}
```

`sequence` and revisions are nonnegative safe integers. Document/epoch identifiers are 1–64 ASCII letters, digits, underscores or hyphens. `resync` and per-document `deleted`, when present, are booleans. Frames contain at most 64 document entries and 16 KiB of UTF-8 JSON. No CRDT bytes, document content, attachment URLs, tokens or other account namespaces travel on this channel. Hints can be duplicated, coalesced or replaced with `resync`; clients retrieve authoritative state through normally authorized HTTP operations and do not apply a hint as document data. The provider checks current accepted authority before publishing; client data frames are refused.

The reference browser adapter coordinates one channel across same-device tabs with a bounded SharedWorker; unavailable coordination falls back to HTTP. Pending edits retain prompt upload/retry scheduling. Only fully synchronized, connected replicas use slower periodic reconciliation. Document locks never surround network work. These coordination, cache, queue and connection-count choices are implementation policy, separate from the discovered wire contract.

Initial local evidence: Node source `5834c61e` and Worker source `df244ec4` passed actual channel frames and seventeen coordinated service scenarios. Later Node source `b9ffc17f` and Worker source `c7b37dba` pass eighteen scenarios plus the consent-lineage regressions and both recovery variants. A 35-second window has no recipient document GETs, while other app polling and a trailing checkpoint PUT remain measured work; this is not a zero-cost claim. These local configured transports do not establish independent implementation conformance or public deployed-provider discovery.


Historical channel captures cited above identify the older source/protocol behavior only; they are not evidence that this independent OIDC metadata migration has passed its new Node/Worker qualification. Provider budgets, ticket/cache sizes, reference timeouts and storage topology are implementation limits, not a requirement to implement another Waypo capability.
