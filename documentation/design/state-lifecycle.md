# State lifecycle and durable cleanup

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

2026-11-02 engineering baseline; durations and implementation mechanisms remain provisional. [Architecture](architecture.md) describes the storage boundary. Every state family needs an owner, durable purpose or deadline, collection trigger and crash-safe executor. Expiry blocks use immediately even if physical cleanup is later. No collector or erasure SLA is implemented by this document.

## Safety rules

- Acknowledged changes retain a durable reconstruction path. Publish a verified structural CRDT snapshot/pointer before removing its covered journal prefix. Older checkpoint completion cannot regress a newer pointer.
- Epoch/generation fences survive deletion and reject delayed patches, uploads, webhooks, refreshes and restored snapshots. Missing rows are not permission to resurrect old authority. Keep only minimal rejection evidence for a justified finite purpose or permanent nonidentifying floor.
- CRDT causal metadata/tombstones cannot be removed just because transport history expired. Require a proven engine-safe algorithm or explicit new epoch with recoverable stale-client handling. A slow/offline client cannot pin unbounded server storage.
- Bound objects, bytes, reservations, operation/actor counts, queues and CPU before expensive work. Logical customer content and physical journals/snapshots/backup/undo overhead have separate ledgers and finite reserves. Churn cannot consume infinite free retention.
- Authorized read/export, contact repair, check-in and explicit deletion remain available under bounded abuse controls at quota/paid-feature exhaustion. Background work is not a human check-in.

## State inventory

| Family | Reclamation condition |
| --- | --- |
| Identity and recovery | Authorized account closure/retention finalization after notice, dependency and revocation checks; never cache-idle expiry. |
| Codes, proofs, pending signup, device approvals | Purpose-specific expiry or atomic use; validity/one-use checks precede cleanup. |
| Sessions/refresh families | Expiry/revocation plus rejection evidence through the last admissible descendant replay. Forgotten rows cannot recreate a family. |
| Discovery/key metadata | Bounded freshness/count/cache policy, never automatic grant deletion. |
| App grants/device registrations | Explicit revocation, endpoint lease or account closure; first-party cookie expiry alone is not app disconnect. |
| Snapshot and accepted patch tail | New snapshot verified and pointer committed; delete only covered entries and superseded objects without bounded active holds. |
| Attachment staging/multipart | Bounded reservation/deadline; finalize/release exactly once; abort abandoned owned objects. |
| Live attachments | Explicit deletion or verified unreferenced grace; current grant/epoch checked on access and finalization. Old references never revive deleted bytes. |
| Notification/signaling/support queues | Item/byte/age/retry limits; terminal/expired payload cleanup with bounded dedup receipts. |
| Archives/backups/audits | Explicit disclosed finite schedule, with narrowly scoped reviewed legal holds where applicable. No indefinite ever-paid/evidence exemption. |
| Client pending changes | Namespace-isolated durable local state where available; rejection/expiry does not silently discard unsynchronized edits. Browser eviction remains possible. |

## Execution and deletion flow

Maintain durable due-work indexes and bounded jobs/cursors rather than bucket/fleet scans on every request. One hosted DO alarm slot schedules the earliest due class; repeated edits coalesce. Compaction cannot starve signaling, contact or deletion. Memory caches reconstruct after arbitrary eviction. Fleet dormant-account discovery needs independent durable scheduling; user visits are insufficient.

Object creation and metadata transactions are separate effects: record staged ownership, verify immutable upload, publish pointer transactionally, then reconcile redundant/orphan objects with bounded prefix cursors and safety leases. Never blanket-expire a snapshot prefix or delete another app/account's objects. Failed cleanup remains retryable, not successful.

Deletion commits a generation first, stops new grants/uploads and revokes relevant credential lineages. Durable jobs erase owned catalogues, journals, files, staged uploads, queues and managed versions. Backups retain disclosed finite physical lifetimes; restored backups apply the deletion ledger before serving data. Archive downloads do not restart retention. Do not claim erasure of external transport copies without evidence.

Legal preservation, where applicable to the operator, requires authenticated reviewed authority, exact scope, expiry/review and restricted audited access. A generic support note cannot create an indefinite hold. Account access remains revoked; release resumes purge without restoring the account.

## Acceptance gates

Engine/adapter tests must crash before/after patch persistence and checkpoint upload/pointer commit; race newer/older checkpoints, deletion/recreation, concurrent attachment references and collector execution; recover after object-store outage; retain acknowledged edits and reject stale epochs; enforce quotas while preserving cleanup/export; expire multipart reservations exactly once; exercise duplicate/delayed outboxes and dedup expiry; prove bounded/fair scheduler progress; and restore a pre-deletion backup without resurrection. Validate actual CRDT/adapter versions and browser persistence behavior before release. Numeric upload/undo/offline/backup durations require measured selection and published policy, not copied historical constants.
