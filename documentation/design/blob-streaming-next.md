# Streaming larger files

Waypo has two file transports over the same app-private blob keys. The basic `createBlobStorage` interface buffers at most 4 MiB. A configured provider can additionally advertise resumable Native transfers through **`waypo_blobs.transfers`** in its OIDC metadata. This is an optional part of the blobs extension; it does not require logs or a provider-managed CRDT.

The maintained Node and Worker reference hosts now publish their configured transfer capability. Actual local email/OIDC → discovery → SDK upload, read, deletion and revocation checks have passed on both runtimes. This replaces the earlier encrypted-chunk proposal on this page. It does not certify a public deployment, maximum-size performance or production Cloudflare costs.

## What the app does

1. Sign in and obtain `blobs:write` for uploads and/or `blobs:read` for downloads. Discover the selected issuer's capabilities; do not infer transfer support from its brand or a storage setting.
2. Start an upload with an app-private key, unique request ID, known file size and create/replace precondition. The provider reserves quota, temporary storage and bounded work before accepting bytes.
3. Send bounded parts, resume the same upload when needed, then commit. The last transaction checks current authority and the original key version. A concurrent replacement wins or loses explicitly; it cannot overwrite a newer version silently.
4. Read the committed version as a stream, optionally by byte range. Consume or cancel the stream. If a key has changed, reconcile its current metadata rather than mixing versions.

The SDK's `uploadBlob` helper reads a `Blob`/`File` one part at a time. Keep its request/upload identity and part-hash map when reconciling interrupted work. It does not start an unrelated replacement automatically after an ambiguous outcome.

```js
import {discoverServiceCapabilities} from '@3sln/waypo/sdk/discovery';
import {createBlobTransfers} from '@3sln/waypo/sdk/blob-transfers';

const capabilities = await discoverServiceCapabilities({issuer});
const profile = capabilities.features.blobs?.transfers;
if (profile) {
  const files = createBlobTransfers({issuer, streaming: profile,
    fetchResource: authenticatedFetch});
  const saved = await files.uploadBlob(file, {
    key: 'photo_123', requestId: crypto.randomUUID()
  });
  const download = await files.getStream(saved.key, {ifVersion: saved.version});
  // Consume download.stream, or cancel it if the user stops the download.
}
```

Here `issuer` is the exact selected issuer, `authenticatedFetch` supplies the app's current scoped access credential, and `file` is the user's chosen `File`. These are source-package examples, not an announcement of a published SDK release. If the capability is absent, offer only a supported smaller-file path or explain that this provider cannot accept the file.

## Limits, storage and cleanup

The reference profile uses 5 MiB parts and a configurable maximum up to 128 MiB per file. It allows at most two unfinished uploads per account and one per app, with a fixed one-hour upload lifetime. A smaller configured provider maximum or available quota can reject a file earlier. These are bounded implementation choices, not a paid entitlement.

Each committed file is one immutable Native object. Its SHA-256 describes the actual file bytes, not a multipart ETag or a chunk-manifest hash. Node streams to local disk; the operator supplies disk encryption. R2 uses provider-managed at-rest encryption. Neither model is end-to-end encryption.

Logical quota, temporary assembly bytes and retained old versions are separate liabilities. A replacement can need physical headroom even when it does not increase the account's logical usage. Expired/cancelled uploads and replaced/deleted files have owned cleanup jobs; unknown I/O stays charged until it is safely resolved. Read/export pins delay physical deletion. Removing a file key from app state does not delete the stored file: the app must explicitly delete the key with the appropriate version precondition.

Use [the self-hosting guide](../implementation/logs-blobs-self-hosting.md) to configure the required capacity and work reserves. Direct signed GET URLs are a separate opt-in delivery policy under review; ordinary authenticated streaming does not require them. Direct write URLs are not supported. A provider-signed GET URL can be replayed until expiry, so mint-rate limits cannot promise a delivery-request or egress-cost cap.
