# Independent application blob storage

> Development contract: locally qualified reference behavior, not a public deployment or production-readiness claim. The current transport is bounded at4MiB; larger streaming files remain explicitly unimplemented.

`waypo_blobs` is an optional OIDC metadata extension independent of `waypo_sync`. An identity provider can implement either, both, or neither. New applications should store files through this extension and, when useful, put the returned key/version in their synchronized app state. Storing or deleting a document does not create, grant, or delete a blob. A `{key,version}` reference is change-detection/CAS metadata, not a historical-version pin: GET returns only the current key. Retired bytes awaiting GC are not app-readable history. Legacy document-owned attachment routes remain a prerelease compatibility surface; new examples prefer blob keys.

```json
{"waypo_blobs":{"version":"1","endpoint":"https://id.example/api/services/blobs","scopes":["blobs:read","blobs:write"]}}
```

The endpoint is an absolute HTTPS URL at the selected issuer's origin, with no query or fragment. Explicit loopback development uses the existing insecure-loopback opt-in. Clients ignore unsupported versions and treat absence as unsupported capability. Metadata is descriptive; existing OAuth/OIDC consent and fresh access-token validation establish authority. ID tokens are not storage credentials.

`blobs:read` permits listing and reading files private to the authenticated account **and authenticated OAuth client**. `blobs:write` permits conditional creation, replacement and deletion in that same namespace. It does not implicitly grant read or synchronized-document access. Applications cannot choose an account ID, client ID, storage namespace, internal backing key or cross-app target in these requests. The provider derives all namespace fields from verified authority and preserves its current origin/DPoP validation. Other apps' keys and metadata are not enumerated.

## HTTP contract

Keys are case-sensitive opaque identifiers matching `[A-Za-z0-9_-]{1,64}`. They are neither URLs nor file paths. Names, MIME types, directory structure and document references belong to app state.

| Request | Result |
|---|---|
| `GET endpoint?after=key` | At most 64 live `{key,version,size,hash}` entries in ASCII key order, with `nextCursor` or null. The cursor is exclusive, app-private, and not a stable snapshot during concurrent changes. |
| `GET endpoint/key` | `application/octet-stream`, attachment disposition, sandboxed content, no-store, and a strong `ETag: "waypo-blob.<version>"`. |
| `PUT endpoint/key`, `If-None-Match: *` | Create only if absent; 201 with metadata and ETag. |
| `PUT endpoint/key`, exact `If-Match` | Replace only that current version; 200 with a fresh version and ETag. |
| `DELETE endpoint/key`, exact `If-Match` | Delete only that version; response `{deleted:true,key}`. |

Missing/ambiguous write preconditions return 428. Changed/deleted versions return 412; neither state nor an old ETag grants permission. Missing reads return 404; unauthorized/revoked access retains existing 401/403 semantics. Normal capacity/rate errors retain current typed retry behavior. The SDK does not automatically replay PUT/DELETE after an ambiguous network outcome. Read the key to reconcile, then decide whether to retry with its current version. A version is a fresh immutable object identity rather than just a content hash, preventing delete/recreate or same-content ABA races.

The current reference transport buffers **at most 4 MiB per blob**, including SDK bounds. This is an implementation limit, not a streaming claim or a larger-file solution. Streaming/multipart upload with durable reservations, byte meters, cancellation and orphan cleanup is a separate prerelease task. Do not raise the buffer ceiling to implement it.

For document file revisions, prefer a fresh immutable app-chosen key: create the blob first, then publish that key in the CRDT. There is no atomic transaction across those operations. A failed document update can leave an intentionally standalone file; the app reconciles and explicitly cleans it later. Concurrent/offline documents may hold stale versions or dangling keys and must handle404/changed versions. Mutable keys are appropriate for cache or app semantics that accept current-value replacement. Neither CRDT GC nor a missing reference authorizes automatic standalone deletion.

## Shared storage, versions and cleanup

The reference implementation reuses the account's existing private-object adapters and paged object catalog. Standalone rows carry `kind:blob`, app namespace, key and version; they have no document or epoch ownership. Internal catalog reuse is not a dependency on the synchronized-state extension.

Current blobs and encoded current document state contribute once to the shared account `used` quota. A document containing a key string does not charge another copy of the blob. This is the existing **current-data logical accounting**: retired versions, upload buffers, encryption overhead and journals have separate bounded physical/staging controls; it is not a claim that `used` measures every physical storage byte or a billing meter.

A PUT reserves full incoming bytes against the staging limit and only positive net growth against logical quota. A same-size/shrinking conditional replacement can work at full logical quota. The final transaction rechecks live authority, lifecycle, exact old version, current shared quota and stage expiry before atomically replacing the catalog pointer. Concurrent replacements have one winner. Failed, expired, revoked or stale uploads remain owned staged objects for bounded cleanup rather than becoming live data. Explicit deletion is permitted without allocating new quota.

Live files and legacy attachments share a finite 4096-row account live stock by default. Catalog pages are capped at 64 × 64 retained rows, including tombstones awaiting physical deletion. Repeated replacements therefore cause cleanup backpressure rather than unlimited metadata/object growth. Listing and lookup currently scan that bounded catalog; a finer indexed app-key lookup is a future optimization, not an unbounded list claim. Zero-byte objects consume row stock. Stage count/bytes/expiry and existing service work budgets also apply.

Replacing/deleting a key retires its old immutable object; active export pins conservatively hold it. Existing autonomous maintenance removes only durably retired objects, respects live references and pins, retries failed deletion, and continues when ordinary app grants or optional services are disabled. Document deletion/CRDT GC never infer that a standalone key is unreachable. Terminal account purge includes all blob rows and confirms object cleanup before identity finalization. Revoking an app grant ends access; it does not itself authorize deleting its files. No new public destructive account/app UI is introduced here.

## SDK and composition

```js
const files = createBlobStorage({issuer, capabilities, fetchResource: authenticatedFetch});
const saved = await files.put('photo_123', bytes); // create only
const read = await files.get(saved.key);
const updated = await files.put(saved.key, editedBytes, {ifVersion: read.version});
await files.delete(saved.key, {ifVersion: updated.version});
```

Use the ETag/version from the latest accepted operation for deletion; stale versions fail without deleting a newer file. The supplied transport obtains current app authority, including proof-bound token handling where used. The SDK does not store credentials, persist an offline authority cache, or queue destructive writes. Applications may retain local drafts partitioned by issuer/account/client and reconcile explicitly on reconnection. A disconnected app's old local blob copy is not server access.

Generic Node/self-host composition enables `services.blobs:true` independently of `services.sync`. It uses the existing private local-disk object adapter, durable metadata, optional encryption and account policies; no Polar, Cloudflare or hosted account is required. Generic and hosted defaults remain off. Worker routing uses the existing per-account actor and prepaid storage/work/lease limits, independently of the document URL. Ordinary revocation keeps the existing bounded lease window; absolute token expiry is not extended. Hosted admission/work policies remain required and no signup, allowance, price or billing activation is changed.

The Notebook sample now prefers the discovered independent file capability, stores a blob reference in its CRDT map, and supports the legacy route only when that capability is absent. The feature remains independently usable by a blobs-only app. Browser and actual Worker qualification of this newly wired surface remain release gates; a source route or passing mock test is not deployment evidence.

The larger streaming/resumable file requirement remains the [next prerelease implementation slice](blob-streaming-next.md); it is not completed by this4MiB transport.
