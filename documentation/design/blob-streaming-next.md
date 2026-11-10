# Larger blobs: next prerelease implementation slice

This is a **provisional implementation plan**, not implemented capability or an owner-approved numerical limit. Independent blob separation is the current slice; its buffered transport remains4MiB. Larger files must be implemented serially after that feature's qualification/integration, rather than raising its allocation ceiling.

## Recommended bounded model

Keep the same app-private key, conditional version pointer, OAuth scopes and independent discovery. Add resumable upload sessions and immutable encrypted chunk manifests. Use existing private Node/R2 object adapters and reviewed per-object AEAD on each bounded chunk; introduce no new whole-file cipher or whole-file `arrayBuffer()`.

Suggested reference profile for review:1MiB chunks, at most128 chunks/128MiB per file, two unfinished uploads/account and one/app, fixed one-hour upload expiry, manifest at most64KiB. Self-host operators may select up to4MiB chunks while retaining the128-chunk ceiling, subject to explicit account/physical/work budgets and actual tests. These are engineering candidates, not free-plan entitlements. A128MiB file fits inside the existing500MB hosted allowance, but an account still needs enough available quota and temporary physical capacity.

The SDK accepts a `File`/`Blob` or bounded byte stream with a declared size. It reads one chunk at a time, computes each chunk hash, uploads, and releases that buffer before advancing; it does not read the entire source into memory. Unknown-length uploads are deferred unless an application first determines length. The manifest records exact ordered chunk references, sizes and SHA-256 values plus total length. Its hash is a **manifest hash**, not falsely presented as the linear SHA-256 of the concatenated file.

## Upload and uncertain outcomes

1. An authenticated begin request selects key, exact create/replace precondition and declared length. The account actor reserves positive logical growth, full bounded temporary physical liability, row/session stock and initial work. No client-selected account/client namespace or direct unbounded presigned PUT is introduced.
2. A chunk request selects a fixed session and chunk index, with exact expected length/hash. Current scope, session owner, expiry and lifecycle are checked before reading. The server reads at most one configured chunk, computes its hash, records owned liability **before** immutable object PUT, and persists a verified receipt before acknowledging. Same index+same accepted hash is idempotent; conflicting index bytes reject. Session IDs are opaque identifiers, never substitute authorization.
3. Status returns bounded pages/bitmaps of verified/pending chunk indexes, enabling restart/resume. Failed network delivery is reconciled, not blindly replayed as a different upload. Work is charged for actual retried/reconciled operations.
4. Once all chunks exist, publish a bounded encrypted immutable manifest. A final same-actor transaction rechecks scope/lifecycle/session expiry, exact key version and quota, then swaps the blob pointer and records an immutable commit receipt. No CRDT update participates in this transaction. A repeated commit returns its original receipt without overwriting any later key state.
5. Cancellation, fixed expiry or failed final CAS retire owned uploaded chunks/manifest; cleanup is paged and acknowledges confirmed deletion. Keep liability for unknown PUT outcomes. A lost process or elapsed session clock is **not** proof that physical storage was never written.

The current `createAccountObjects.put` deliberately refuses an already reserved immutable key. It therefore needs a reviewed reconciliation port before resumable retries can reuse a part: verify an existing bounded object against expected length/hash, or settle/quarantine an unknown attempt before confirmed deletion/replacement. Do not clear that ownership row or refund bytes merely because GET timed out or a lease expired. If an alternative retry object is allocated, both liabilities remain charged and attempts are finitely capped. This is an implementation prerequisite, not something an idempotency header alone solves.

Commit receipts and cancelled-session tombstones need finite stock/retention (candidate24h, bounded count), with no upload-ID reuse or replayed finalization after cleanup. A receipt says an operation once committed; it does not promise its version is still current/retrievable. After receipt expiry, clients reconcile the current key explicitly.

## Download, authority and resource bounds

Return a `ReadableStream` that obtains/decrypts at most one or two chunks ahead under backpressure. Add reviewed byte ranges and exact-version `If-Match` so an interrupted transfer resumes without mixing versions. GET still means the current key; there is no historical-version API. If the key changed, return412 rather than silently assembling different revisions.

A bounded read pin retains the immutable manifest and chunk graph during an active response. Release on completion/cancel and enforce an absolute/idle deadline plus per-account stream concurrency. Check fresh authority at chunk-release boundaries using the existing bounded ordinary-service lease; no hidden extension past absolute token expiry. Exhausted work blocks or expired authority terminate a partial transfer; SDK resumes only after obtaining current normal authority and reconciling version. Headers/status cannot retroactively become503 after bytes have started, so partial-body failure/resume is an explicit client contract.

Reuse the existing service work/prepaid account actor contract without a control RPC for every chunk. Charge byte/chunk work and renew finite blocks as needed. Enforce per-request CPU/ingress controls separately; prepaid admitted work is not a total Cloudflare bill guarantee.

Full incoming/replacement bytes consume independent staging/physical capacity even when net logical growth is zero. Old current versions, pending uploads, encrypted overhead, manifests and retained exports coexist. The current16MiB test actor profile cannot support a128MiB upload: runtime/config validation must require a qualified physical account/fleet envelope before advertising larger transfer. Never pretend the500MB logical quota itself reserves all transient physical bytes.

## Ownership, GC, export and migration

A committed version owns its immutable manifest and exact chunk graph. CRDT reachability is irrelevant. Replacing/deleting that blob explicitly retires that graph after bounded export/read pins. A document deleting its key string never authorizes object deletion.

Use paged upload/chunk ownership metadata and bounded cleanup jobs. Do not embed128 full chunk records into every row of the existing64-row metadata page; it could exceed storage-value limits. Maintain finite global/account chunk and manifest stock, including zero-byte files and unknown-outcome objects. A manifest in R2 does not make its Native/DO metadata or object ownership unboundedly scalable.

Existing export preparation currently caps8320 entries and assumes one backing object per attachment row. Chunked files require a deliberate bounded extension: export immutable manifests plus all referenced chunk objects in stable pages, preserving pins across the full graph and keeping counts/byte totals exact. Do not silently omit chunks, increase export indexes without measuring bounds, or call a manifest-only backup complete. Account purge must stop active upload commits, retire all session/version graphs and pins, and confirm their physical cleanup before Native identity finalization. Restore must validate the same graph without reviving revoked grants.

Keep legacy single-object blobs and document-owned attachment reads supported during prerelease migration. Add a versioned storage encoding/manifest profile; do not interpret an old object's bytes as a manifest by content guessing. New large uploads use the new encoding; old data need not be copied eagerly. Layout activation/config fingerprints must reject stale writers/mixed incompatible layouts during rollout.

## Required acceptance before larger-file readiness

- Real Node and actual workerd uploads/downloads of a file exceeding4MiB, with measured maximum buffered residency independent of total file length; no whole-file cipher/decode path.
- Two apps/accounts, same key isolation, read-only vs write-only scopes, current revocation/absolute expiry during upload and download, and bounded cross-origin preflight.
- Conditional concurrent commits, same-size replacement at full logical quota with sufficient physical headroom, zero-byte/chunk/session stock exhaustion, and shared CRDT+file quota without double counting.
- Lost chunk/commit responses, corrupt/duplicate/out-of-order parts, crash after reserve/PUT/manifest/final CAS, restart/resume, cancellation, expiry and unknown-outcome quarantine with no time-only refund.
- Slow-reader backpressure, interrupted range resume, stale-version412, changed key/deletion, active export/read pins, paged GC, archive/export/restore and terminal purge including every owned chunk.
- Provider metadata/SDK fallback for absent large-transfer support. Browser evidence must use the frontend streaming API; backend buffered success alone is insufficient.

Root review of the numerical/profile and ownership/export contracts precedes implementation. This plan adds no deployed flag, price, storage entitlement, billing action or signup capacity.
