# Self-serve account deletion, data export and email removal

Status: design with local implementation, updated 2026-10-22 (DX-10 status below). This document does not change a production gate in [security.md](../spec/security.md). Reviewer ___ / Date ___ / Outcome ___. Decisions below are provisional until signed off in [DEVLOG.md](../../DEVLOG.md). Local reversible implementation may proceed behind the default-off flags in §8, under the user's standing authorization.

**Why.** The legal drafts promise things owners cannot do today:
- account deletion on request ([privacy §8–9](../legal/privacy.md), [terms §10](../legal/terms.md));
- a full, portable export (privacy §9);
- removal of a confirmed email (privacy §9);
- a chance to export before over-quota removal (terms §7) and before closure (terms §10).

[docs/legal/README.md](../legal/README.md) lists all four as publication blockers. This document closes them by reusing the lifecycle purge executor and the D092/D093 export design, not by building a second deletion path.

## 0. Decisions in one screen

1. **One deletion executor.** Owner deletion, admin-assisted deletion and inactivity purge all run the same `purgeBatch` in [lifecycle-storage.mjs](../../packages/runtime/lifecycle-storage.mjs). It gains a `reason`, a billing stage, an export-cleanup stage, a drain stage and a `beforeWipe` hook. The identity tombstone keeps `RETAINED` unchanged, so names are never reassigned.
2. **Grace period: 14 days.** Deletion is self-serve, with passkey/password step-up and the typed full handle.
   - It becomes 30 days if a security-sensitive change happened in the 72 hours before the request. Changes are read from a dedicated identity `security` state, never from the rolling security log (§2.1, R1-H1).
   - A security-sensitive change *during* grace moves the deadline to at least 14 days after that change and sends a notice.
   - The owner cancels by signing in (an interstitial with one click) or with a cancel-only link sent to the confirmed channels (email and push).
   - Nothing is revoked during grace, so cancelling restores everything.
3. **Execution order:**
   1. fence the account (410);
   2. stop billing;
   3. sever connections and tombstone the identity (sessions, credentials, recovery, email claim, app-grant lineage);
   4. erase federation and MCP grants;
   5. drain integration and severance outboxes (bounded);
   6. purge vectors, email-bridge state, exports, archives and blobs;
   7. anonymize the Polar customer;
   8. send the final notice;
   9. wipe metadata and leave the account tombstone.

   This deliberately moves the identity tombstone **earlier** than the brief's order (§2.3). Inactivity purge runs the same executor with the same erasure stages (4, 5, 6 and 9). Only the billing stages (2, 7) and the owner notice (8) depend on `reason` (R1-H3).
4. **An active subscription does not block deletion.** At request time the system sets `cancel_at_period_end`, and undoes that on cancel if it set it. At execution it revokes the subscription. No automatic refund is made; refunds follow the refund policy and consumer law (open question Q2).
5. **Export format: a deterministic virtual tar** (`bindle-export/1`).
   - JSON-lines parts are generated once into R2.
   - Payload bytes are referenced and streamed from the existing immutable blob versions, never copied.
   - Layout is fixed at seal time, so every byte offset is computable. Any download resumes with HTTP `Range` at near-zero Worker CPU and has no size ceiling.
   - The export is split into volumes of at most 2 GiB and at most 900 R2 reads. Payloads of 256 KiB or less are copied into prebuilt tar *pack* segments during generation, so a volume can hold many small entries per read (§1.2, R1-M5).
6. **Download authority:**
   - the browser uses the owner session cookie on a `GET` with a job-scoped path;
   - the CLI uses a short-lived job grant in a header (D093);
   - never a presigned R2 URL, and no token in a URL.
7. **Export abuse limits:**
   - a fresh step-up (5 min, password or passkey) to create a job or mint a CLI grant (R1-M1);
   - one active job per account and two per 7 days;
   - a notice to the confirmed channels on creation and on the first download from each session or CLI grant (R1-L7);
   - a 72-hour ready-delay after a security-sensitive change;
   - a per-job download cap of 3× the export size;
   - a 7-day expiry.
8. **Email removal** is an identity CAS that releases the email index. It is refused when no other verified notice channel exists, unless the owner records an explicit notice waiver (Q4).
9. **Three new class (a) rollout flags**, all off by default (§8):
   - `ACCOUNT_EXPORT_ENABLED`
   - `ACCOUNT_DELETION_ENABLED`
   - `EMAIL_REMOVAL_ENABLED`

   They gate *new* requests only. Cancel, status, download of an existing export, and background execution follow the env kill switch only (feature-flags §0.7, §4).

## 1. Export

### 1.1 Scope

The export holds everything the account holds for its owner, plus what the system holds *about* the account. Data comes from **contributors**: each domain registers a projection that applies its own redaction. The export domain never reads raw keys.

| Contributor | Included | Excluded (always) |
|---|---|---|
| `identity` (identity port) | id, handle, aliases and assignment; createdAt; status; terms version and acceptance time; verified email and its time; email-login setting; passkeys (id, label, createdAt, lastUsed, backedUp); password present (yes/no); sessions (label, source, created, last used, expiry); **security log** (`account.audit`, last 100); linked-approval lineage summary; public name certificate | password hash, recovery hash, session and CSRF hashes, challenges, email tokens |
| `keys` | public keys and key IDs | private signing and encryption keys. Those leave only through the separately protected identity backup ([identity-backup.mjs](../../packages/runtime/identity-backup.mjs)); the manifest links to that workflow. |
| `messages`, `collections`, `tags`, `rules`, `views`, `activity`, `notifications` | message metadata and body payloads, collections, labels, rules, views, activity items, notification preferences | push endpoint URLs and keys (capability URLs); unsubscribe tokens |
| `contacts`, `contact-grants`, `conversations`, `links` | contacts, names, issued contact grants (recipient, created, revoked), conversation items authored or received, link records; the contact profile (`profile`), saved contacts (`saved-contact/`), contact sharing grants (`contact-sharing/`) and contact redemption bindings (`contact-redeemed/`) | shared secrets, return capabilities and bootstrap material ([contact-delivery §161](../spec/contact-delivery.md)) |
| `resources` (hosted) | resource descriptors, logical keys, versions, content types, sizes, payload bytes | private physical bucket keys (`blobRef`) |
| `connections`, `integrations`, `events` | connection records (provider, label, scope, created, status), event-bus descriptors and retained history, integration assignments | OAuth tokens, S3 keys, any vault secret |
| `external-storage` | **references only**: provider, resource ID, bucket/prefix or Drive folder ID, and the **host-held logical-key → provider-object mapping** with versions | external bytes (never copied, §1.5) |
| `grants` (federation store port) | app grants (client, fragments, fields, resources, methods, created, expiry), device grants | tokens, JTIs |
| `billing` | plan, status, period start/end, `cancelAtPeriodEnd`, ever-paid marker (yes/no and since), Polar customer ID, and a link to the Polar portal for invoices | Polar credentials |
| `lifecycle`, `quota` | lifecycle phase and deadlines, storage usage, retention-episode state (D092) | — |
| `features` | evaluated value and reason for every class (a) flag, and the experiment variant for this owner (`flags.for(ctx)`). Assignment is derived, not stored, so it is exported as evaluated at export time. | other owners' buckets |
| `apps-held` | a list of connected apps (BindleBox included) that may hold copies, each with "export it there" guidance | the apps' data |

**Inventory completeness test.** An engine test enumerates every metadata key prefix the account writes (the table above, plus the `key('…')` families in [core/records.mjs](../../packages/core/records.mjs)). It fails unless each prefix is either claimed by a contributor or listed in `EXPORT_EXCLUDED_PREFIXES` with a reason:
- derived: search vectors, item index, usage counters, the `contact-redeemed-peer/` index;
- transient: challenges, leases, journals;
- secret: grants' secrets, vault.

Fixed 2026-10-26 (provisional): the contact profile, saved contacts, sharing grants and redemption bindings used to sit under `beam/` and were wrongly excluded with the transient Beam state. With Beam removed they get neutral keys. During release v1 (`beam-retired-v1`) both keys are written and the legacy row is authoritative, so the contributors (`profile`, `contact-sharing`, `contact-redemptions`, `saved-contacts`) export the legacy rows and list the neutral copies as excluded forward copies; `beam-retired-v2` moves the contributors to the neutral keys when it deletes the legacy rows. Singleton keys (`profile`, `beam/profile`) match exactly, never as prefixes.

This keeps the export honest as domains grow.

### 1.2 Format: `bindle-export/1`

The archive is a deterministic POSIX tar, using pax headers only where ustar cannot express a field. Paths are fixed ASCII built from stable IDs, as D093 specifies. A logical key never becomes a path; it is kept in the JSON.

```
manifest.json                           root: format, version, issuer, subject, jobId, purpose,
                                        createdAt, sealedAt, consistency:"paged", startedAt/finishedAt,
                                        counts/bytes per contributor, parts[{path,size,sha256}],
                                        payloadIndex parts, volumes[{n,bytes,firstEntry,lastEntry}],
                                        excluded[{prefix,reason}], unknownRestoreSemantics[...]
account/<contributor>.<nnnn>.jsonl      ≤16 MiB per part; one JSON object per line; schema version per contributor
payloads/index.<nnnn>.jsonl             {entryId, kind, source:{resource,key,version}|{message,part}, size,
                                        contentType, sha256, path, volume}
data/objects/<resourceId>/<entryId>.bin
data/messages/<messageId>/<n>.bin
README.txt                              human description, the redaction list, the restore caveats
```

Volume 1 holds `manifest.json`, `README.txt`, every `account/*` part and the payload index. Later volumes hold payloads only. Every volume is a standalone tar.

**Why tar, not ZIP.**
- ZIP needs a CRC-32 of every payload. A Worker would have to compute that in JavaScript over up to a terabyte, or precompute and store it.
- Tar needs only a 512-byte header checksum. Sizes are known from metadata, so an offset maps to (entry, offset within entry) arithmetically.
- `Range` support therefore costs nothing and resume works in any browser download manager.
- macOS, Linux and Windows 10+ (`tar.exe`) all extract tar natively.

D093 already rejects ZIP for large accounts.

**Payload digests.** Generation computes SHA-256 for every payload through a `digest` provider. On Workers it is `crypto.DigestStream`, which is native and costs no JavaScript CPU per byte. On Node it is a streaming `createHash('sha256')`, because Node has no `DigestStream` (R1-M9). The cost is one extra R2 read per payload. The manifest therefore authenticates payloads (D093), and the CLI verifies them.

**Small-payload packs** (R1-M5). A cap of 900 referenced entries per volume would split an account of 100,000 small messages into more than 100 volumes, which no browser user can download by hand. So generation copies every payload of 256 KiB or less into *pack* objects under `exports/<owner>/<jobId>/pack.<nnnn>`, each up to 16 MiB. A pack holds finished tar segments: header, data and padding for each entry, back to back. The digest is computed while copying. A pack counts as one R2 read when streamed. Only larger payloads are referenced from `BLOBS`. Packs are job parts, so they are listed in `parts`, deleted by exact key on expiry, cancellation or E6, and their bytes are bounded by the account's quota. The tar output is the same either way; packing changes only where the bytes are read from.

**Sizes and integrity at stream time** (R1-L5). Each referenced entry's `size` is the R2 object's `size` observed in the digest pass, never the metadata row's claimed size. The streamer checks `object.size === entry.size` before writing the entry's header. If the object is missing or its size differs, the stream **aborts** (the response errors and no `0`-padding is sent), so a client never receives a misaligned tar. A rewrite to Infrequent Access keeps the bytes but changes the etag, so the check uses size, not etag; the CLI's SHA-256 check covers content. Responses use `FixedLengthStream` with an exact `Content-Length` for the full volume or the requested range.

### 1.3 Size limits that shape this

Figures as last checked. Verify against Cloudflare documentation before release.

| Limit | Value | Consequence |
|---|---|---|
| Worker isolate memory | 128 MB | Never buffer a part or a volume. Stream R2 bodies through a `TransformStream`. Parts are capped at 16 MiB so generation can hold one in memory if needed. |
| Worker CPU per request | 30 s default, configurable on paid plans | Tar streaming is header arithmetic plus `pipeTo`. CPU per byte is negligible. |
| Subrequests per invocation | 1,000 on paid plans; R2 binding calls count | At most 900 R2 reads per volume (a pack or a generated part counts once), so one volume download stays within one invocation |
| DO alarm invocation | bounded wall time | Each generation and deletion step is budgeted (≤500 rows, ≤32 digests, ≤20 s) and re-arms the alarm |
| R2 single `put` | ~5 GiB; multipart for larger | Parts are 16 MiB objects, so multipart is unnecessary |
| Account archive envelope | 8 MiB, 2,200 rows ([accounts.mjs](../../packages/runtime/accounts.mjs) `warm`) | Shelved accounts are restored by `warm()` before generation (§1.5) |
| Hosted object | 1 MiB today; messages may be larger | An entry larger than the volume target gets a volume of its own |

Generated parts live in the `ARCHIVES` bucket under `exports/<owner>/<jobId>/`. The job record lists every key it wrote, so cleanup deletes exact keys and never lists the bucket (D093: "Do not scan/list the backing R2 bucket").

### 1.4 Generation: asynchronous, resumable, bounded

Job record at `export/job/<id>` in the account store (one per account while active, with a cap of 2 per 7 days, counted from `export/history`):

```
{v:1, id, owner, purpose:'owner'|'over-quota'|'closure', operationId, fingerprint,
 createdAt, notBefore, state:'queued'|'generating'|'sealing'|'ready'|'cancelled'|'expired'|'failed',
 contributor, cursor, parts:[{key,size,sha256}], digestCursor, payloads:{count,bytes},
 volumes:[…], rootDigest, expiresAt, downloadedBytes, downloadCap, securityEpoch, sessionsSeen[], failure?}
```

States:
- **queued → generating.** The account alarm runs `exports.step` (system actor). Each step:
  1. reads one bounded page from the current contributor;
  2. appends to an in-progress part, flushing it to R2 at 16 MiB;
  3. records the part key, size and SHA-256, and advances the cursor in **one** account transaction after the R2 put succeeds.

  A crash before the transaction leaves an orphan part key that is not yet in `parts`. The next step overwrites that same deterministic key (`<contributor>.<nnnn>`). Nothing is ever appended to an object.
- **Digest pass.** Each payload's SHA-256 is computed and recorded in the payload-index row before that row's part is flushed.
- **sealing.** The step computes the volume layout, writes `manifest.json` last, computes `rootDigest` and sets `ready`. No byte is served before `ready`.
- **ready.** The job expires 7 days after `ready`. Expiry and cancellation delete the exact part keys, then the record moves to a bounded `export/history`.

`exports.step` runs from the account alarm only while there is no `deletion/fence-v1` and no `lifecycle/purge-v1`. Those executors cancel jobs themselves (stage E6). Generation runs outside the account gate: R2 puts happen outside transactions, and only the cursor commit is transactional, so owner operations do not wait behind a 20-second step.

**Consistency.** Generation is paged over live state (`consistency:"paged"`), with start and finish times in the manifest. A row changed between pages appears in whichever state the pager saw. The full before-image journal of D093 is required for *destructive moves* only; it is not required for a download export. The manifest says this plainly.

**Payload stability.** Payloads are immutable blob versions. While an export job is `generating` or `ready`, physical deletion is deferred **only for the exact refs that job indexed** (R1-M6):
- When the pager writes a payload-index row, it also writes `export/pin/<sha256(ref)>` with `{jobId, size}`, in the same transaction as the cursor.
- `collectBlobGarbage` skips a garbage row only if its ref has a pin. Every other ref is collected normally, including objects created and deleted after the pager passed them.
- Pinned garbage bytes are capped at the account's current quota. If the cap is reached, the job fails with `export_pin_budget`, its pins are dropped, and the deferred rows become collectable.

So an owner cannot keep uploading and deleting to hold unbounded R2 bytes outside quota for the life of an export.

Pinned rows stay in `blob-garbage/` and are retried after expiry or cancellation.
- This needs every physical delete path to go through `blob-garbage/` first. That is the "message deletion crash window" fix D093 already requires, and it is a prerequisite hunk in [accounts.mjs](../../packages/runtime/accounts.mjs).
- The UI states: "Files you delete while an export is available are kept until it expires or you cancel it."
- Account deletion and inactivity purge both cancel exports immediately (§2.3, stage E6).

**Notices.** A short notice goes to the confirmed channels on creation and on the first download from each distinct session or CLI grant, which are recorded in `sessionsSeen` ("An export of @handle was requested / downloaded. Not you? Cancel it and secure your account"). Cancel is one click from the notice, after sign-in. A notice per new session means a stolen cookie that downloads after the owner already has cannot do so silently.

### 1.5 Cold-archived, suspended and external-storage accounts

- **Shelved (seven-day cache shelving).** Any owner operation already runs `warm()`, which restores `message/` and `resource/` rows from `ARCHIVES` with an integrity check. Export generation runs after `warm`, so no archive-specific reader is needed.
- **Lifecycle-suspended or cold-tiered.** Export operations declare `lifecycle:'suspended'`, so they stay available without reactivation. This adds export to the restricted list in the [lifecycle-runner](../../packages/runtime/lifecycle-runner.mjs) header comment, which is a recorded policy change.
  - Infrequent Access retrieval costs $0.01/GB, so a suspended account gets one export per notice episode.
  - Export never counts as `activity`, so it cannot silently reactivate the account.
- **Connected external storage** (Google Drive, S3, WebDAV). The export contains references and the **host-held mapping** only. It never copies external bytes; they stay in the owner's storage (privacy §8).
  - The Drive mapping is exactly the "independently restorable private manifest" the [executor design](../release/account-lifecycle-executor-design.md) needs before host mappings may be deleted.
  - This export is therefore also the evidence that lets the inactivity purge stop holding accounts with external connectors. That wiring is a later decision; it is not part of this design.
- **BindleBox and other connected apps.** The export lists them under `apps-held`. BindleBox's own `archive.export` stays in BindleBox; the console links to it when `BINDLEBOX_ENABLED` is on for the owner.

### 1.6 Download

The download routes adopt D093's route shapes as a subset:

| Route | Authority |
|---|---|
| `POST /api/exports` | owner session, Origin/CSRF, **fresh step-up** (`IdentityService.privileged(context, 300000)`, R1-M1), `operationId`, and a `purpose` limited to `owner` (the others come from §4 hooks) |
| `GET /api/exports`, `GET /api/exports/:id` | owner session; status, counts, volume list, `notBefore` and expiry |
| `POST /api/exports/:id/cancel` | owner session and CSRF. Always available, regardless of flags. |
| `GET /api/exports/:id/volumes/:n.tar` | owner session cookie (`SameSite=Strict`, so a cross-site navigation carries no cookie), job owner match, `state==='ready'`, `now<expiresAt`, unchanged identity `security.epoch` (any security-sensitive change, including recovery or a credential reset, invalidates it; §2.1), and `downloadedBytes<downloadCap`. The requested range length is charged to `downloadedBytes` before streaming starts. Supports single `Range`, `If-Range` with the volume ETag (`rootDigest`+n), 206/416. Sends `Content-Disposition: attachment`, `Content-Type: application/x-tar`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. |
| `POST /api/exports/:id/grants` | CLI only (D093). Mints a header-borne, read-only grant for this job. It needs a fresh step-up and sends a notice. Its lifetime is `min(24 h, expiresAt)`, because a 5-minute grant cannot outlive a multi-hour resumable download (R1-L6). Its `securityEpoch` is bound like the session route's. The token hash is stored, and `DELETE /api/exports/:id/grants/:grant` revokes it. |

Why not presigned R2 URLs:
- the R2 binding cannot presign; that needs S3 API credentials in the Worker;
- the bearer would sit in a URL, which security.md forbids;
- a virtual tar has no single object to presign.

The edge Worker streams payload bytes from `BLOBS` directly. The account DO is called once per request, to authorize and return the volume layout slice. The layout is cached per isolate by `rootDigest`.

### 1.7 Engine operations

The operations live in the new domain `packages/app/domains/account-export.mjs`. Every operation's payload is `{actor, id?, input}`.

| Operation | Actor | Policy |
|---|---|---|
| `exports.create` | owner (the adapter passes `stepUpAt` and `securityEpoch` from the identity port) | `lifecycle:'suspended'`, idempotent `operationId` receipt in the same transaction, `export_rate_limited`, `export_active`, `account_deleting` |
| `exports.list`, `exports.status` | owner | `lifecycle:'suspended'` |
| `exports.cancel` | owner, system | `lifecycle:'purging'` (deletion uses it) |
| `exports.step` | system | `lifecycle:'suspended'`; bounded; returns `{busy, wakeAt}` |
| `exports.layout` | owner, export-grant | query for the edge stream adapter; `lifecycle:'suspended'` |
| `exports.expire` | system | `lifecycle:'purging'` |

Providers: `accountStore`, `archives`, `blobs` (read), `clock`, `random`, `config` (flags), plus the contributors, which are read-only ports onto existing domain providers.

## 2. Deletion

### 2.1 Request

`deletion.request` requires all of:
- a **fresh step-up** via `IdentityService.privileged(context, 300000)`: password or session-bound passkey. Recent sign-in alone is not enough.
- the **typed full handle** (`@n.example1234` style; the exact canonical handle);
- an acknowledgement checklist:
  - "Messages others received stay with them."
  - "Files in connected storage stay there."
  - "Your name is never reassigned and cannot be reused."
  - "Your active plan ends without automatic refund" (only if paid).
- a fresh `operationId`.

It is refused with:
- `recovery_pending` while recovery is in progress;
- `account_suspended` for admin-suspended identities (they use §2.6);
- `deletion_scheduled` if one is already scheduled (the call is idempotent per `operationId`);
- `admin_role_held` while the identity holds the built-in `admin` role or has system-identity provenance (R1-L9). Boot revokes the role first, so a takeover of an administrator cannot silently remove the operator's own access path.

**Lifecycle levels** (R1-L8):
- `deletion.request` and `deletion.status` declare `lifecycle:'suspended'`, so an inactivity-suspended owner can still exercise erasure.
- `deletion.cancel`, `deletion.cancel-token` and `deletion.step` declare `lifecycle:'purging'`.

**Billing at request time.** `cancelAtPeriodEnd` is attempted synchronously. If Polar fails, the request still commits with `billing.pending:true`, and `deletion.step` retries hourly; E1 revokes regardless. Checkout and plan-change creation are refused with `deletion_scheduled` from this point. That is a coordinator hunk in `account/billing.mjs` (§8.2).

During a pending **terms re-acceptance** (terms §12), the gate must exempt the following. Each declares a new operation static `termsGate:'exempt'`, which the future re-acceptance slice must honour:
- `deletion.*`
- `exports.*`
- `identity.email-remove`
- sign-out
- status

Deleting must never require accepting new terms.

Record `deletion/request-v1` in the account store:

```
{v:1, id, owner, basis:'owner'|'admin-email'|'admin-underage'|'admin-closure', operationId, fingerprint,
 requestedAt, executeAfter, graceDays, actor:{kind, sessionId?|adminAuditSeq?},
 channels:{email, emailVerifiedAt, push:[{id, endpoint, keys}]}   // copies, not references; dropped at wipe
 cancelTokenHash, billing:{setCancelAtPeriodEnd:[{subscriptionId, canceledAt}…], pending?, evidence},
 state:'scheduled'|'cancelled'|'executing'|'held'|'deleted', hold?, stage?, notices[], revision}
```

**Grace.**
- 14 days by default.
- **30 days** if a security-sensitive change happened in the previous 72 hours.
- The deadline is server-derived and persisted. Later configuration changes never shorten it.
- A security-sensitive change **during** grace sets `executeAfter = max(executeAfter, change + 14 days)` and sends the scheduled-deletion notice again (R1-M2). Recovery during grace is the clearest takeover signal, and this guarantees the recovered owner a full window.

**Identity security state** (R1-H1). The identity record gains `security:{epoch, changedAt}`. It is bumped in the **same CAS** as each security-sensitive change:
- verified email added, changed or removed;
- the email-notice waiver (§3);
- email sign-in enabled;
- a credential added or removed;
- password set or changed;
- recovery-file recovery.

It is exposed through a trusted port, `identitySecurity(owner) → {epoch, changedAt}`. Grace length (§2.1), the export ready-delay and the export download binding (§1.6) all read this state.

They must **not** read the security log. `IdentityService.audit` keeps only the last 100 entries, and cheap events such as `session-created`, `session-closed` and `step-up` would let an attacker push an email change out of the window by signing in about fifty times. `security` is also on the identity tombstone's discard list, not `RETAINED`.

**Notices.** These go to the channel snapshot, using the existing mail (`accounts@`) and push transports, independent of `LIFECYCLE_ENABLED`:
- immediately ("Deletion of @handle scheduled for {date}. Not you? Cancel");
- at T−3 days and T−1 day;
- at execution start;
- at completion (email only).

Email and push notices both carry a **cancel-only link** (R1-M2). A push-only owner otherwise has no way to cancel without signing in, and an attacker who took over may have changed the credentials. The link is:
- a 256-bit token whose hash is in the request;
- valid while `state==='scheduled'`, not until a wall-clock time, so a held or late commit never strands it (R1-L4);
- confirmed with a `POST` from a static page, never a GET side effect, because mail scanners prefetch links;
- unable to grant sign-in.

Push notices go to the endpoint **copies** in the snapshot. Deleting push-subscription rows after the request therefore cannot suppress them.

Before commit, at least one provider-accepted notice to the snapshot is required whenever the snapshot holds a channel, for every basis. Until then the step holds, and the owner is told that on the status screen (R1-M2). A step-up proves possession of a password, which can be phished; it does not prove the owner has seen the request. An owner whose snapshot has no channel was warned on the confirmation screen and proceeds without that requirement.

**During grace** the account works normally. Apps keep working and new mail arrives. These are the only blocks:
- new plan purchases or upgrades (`deletion_scheduled`);
- a second deletion request;
- inactivity lifecycle steps, which hold with reason `deletion-scheduled` while a request is scheduled **or executing**, so the two executors never share `lifecycle/purge-v1`.

Exports remain available and are encouraged; the confirmation screen offers "Export first".

**Cancel.**
- `deletion.cancel` works from any owner session; no step-up, because cancelling is the safe direction.
- `deletion.cancel-token` works with the emailed token.
- After sign-in, the console calls `GET /api/account/deletion`. If deletion is scheduled, it shows an interstitial with **Cancel deletion** and **Keep it scheduled**.
- Signing in does **not** cancel silently. A legitimate owner signing in on a second device must not undo their own request by accident.
- Cancel undoes `cancel_at_period_end` **only** on the subscriptions this request set (`billing.setCancelAtPeriodEnd`). It does so only while each one is still `cancel_at_period_end` with the same `canceled_at` it recorded, so a cancellation the owner made later in the Polar portal is kept (R1-L3).
- If a billing period ends during grace, the subscription ends then and cannot be restored by cancelling. Cancel reports which subscriptions could not be restored. The confirmation screen says so before the request: "If your billing period ends before {date}, your plan ends then."

### 2.2 Commit at the deadline

The account alarm (`deletion.step`, system actor) runs **before** `lifecycleTick` in `AccountController.alarm`, independent of lifecycle mode. When `now ≥ executeAfter`, it acts in one account transaction:
1. re-read the request;
2. if `state==='scheduled'` and the admin hold is not held, set `state:'executing'` and write the **fence** `deletion/fence-v1`.

`deletion.cancel` uses the same transaction boundary, so a sign-in-and-cancel racing the deadline linearizes:
- if cancel commits first, the request is `cancelled` and no effect has run;
- if commit wins, cancel returns `deletion_in_progress` (410).

The fence makes `lifecycleBlocked` answer `account_deleting` (410) for every operation not declared `lifecycle:'purging'`, in every lifecycle mode, as the purge does today. Every account invoke also checks whether the deadline has passed.

**Wake invariant** (R1-M4). An invoke-time check does not help an abandoned account that receives no requests. And today's `alarm()` calls `this.metadata.setAlarm(...)` directly on its maintenance-retry paths (`now + 7 days`), which can move the only alarm past `executeAfter`. So:
- `deletionTick` returns `{wakeAt}`, and `alarm()` re-arms with `min(current, wakeAt)` in a `finally`, after every other path.
- Every direct `setAlarm` in `accounts.mjs` goes through a helper that applies the same minimum.
- The `LifecycleScheduler` sweep (Worker cron and the Node scheduler) calls `deletionTick(owner)` for accounts with a scheduled request, independent of `LIFECYCLE_ENABLED`. It finds them through a `deletion-due/<executeAfter>/<owner>` index row in the identity directory, written by `deletion.request` and removed by cancel or E11.

### 2.3 Execution order and crash safety

Each stage is idempotent, bounded and resumable from the durable `lifecycle/purge-v1` job. The job gains `reason` and the new stages. The alarm re-arms at +2 s while busy and backs off on holds (1 h, doubling up to 1 day for transient faults; operator alert after 7 days). Before every destructive stage, a fresh `fence()` re-checks three conditions:
- the request is still `executing`;
- there is no admin hold, read through `deletionHold(owner)` (§4.2), not the lifecycle port that counts every suspended identity as held. A legal hold freezes deletion but does not cancel it;
- the owner still matches.

**The fence also stops the alarm's other work** (R1-H2). Today `AccountController.alarm()` returns early only when `lifecycleTick` reports `deleted`. Otherwise it continues with conversation drain, event-bus sweep, integration revalidation, semantic `configureSemanticSearch`/`backfillSemanticSearch` and seven-day **shelving**, none of which pass through `lifecycleBlocked`. During execution that causes two failures:
- Shelving between E7 and E8 moves `message/` and `resource/` rows into `ARCHIVES` after E7 found nothing shelved. The E8 scan of live rows never sees them, so their blobs survive deletion.
- A backfill after E5 re-creates Vectorize embeddings whose enumerating rows E11 then wipes, so they are orphaned for good.

Therefore:
- `alarm()` returns immediately after `deletionTick` (re-arming per §2.2) whenever `deletion/fence-v1` or `lifecycle/purge-v1` exists. The same early return applies to the existing inactivity purge, which has the same defect today.
- E4 calls the drains it needs directly.
- Shelving and semantic backfill also refuse while a request is `scheduled`, so the shelved state cannot change underneath a committing request.
- As a final guard, E8 ends by re-reading `shelved`. If it is set, the job returns to E7.

| Stage | Effect | Why here |
|---|---|---|
| **E1 billing-stop** | `reconcile(owner)`. For every active or past-due subscription, call `subscriptions.revoke(id)` (Polar SDK). Treat `AlreadyCanceledSubscription` / inactive as success. Then confirm that `checkouts.list({external_customer_id:owner, status:'open'})` is empty, holding until any open checkout expires, and re-read customer state to confirm no active subscription remains (R1-L2). Record evidence. A Polar failure **holds**. | Before anything irreversible. A deleted account must never renew. Setting `cancel_at_period_end` at request time already prevents renewal during grace; E1 ends the entitlement. |
| **E2 identity** (existing stage) | `connectionsSeverAccount(owner,{reason:'account-deleted'})`, then `identity.tombstone(owner,{assignmentId, reason})`: sessions, credentials, password, recovery hash, challenges, `verifiedEmail` (the email index is released in the same CAS), `revokeAllLineage` (app families enter `lineageOutbox`, kept on the tombstone). | This **is** "revoke sessions and app grants". Doing it right after billing closes the window in which a signed-in session or app could act while content is being deleted. Every federation exchange and RPC already re-checks identity status ([federation-implementation](../spec/federation-implementation.md)), so access ends here even before notifications land. |
| **E3 grants** | `federation.eraseSubject(owner)`: delete grant, token-family, preference and brokered-JTI rows for the subject in the federation store. Then `mcp.eraseSubject(owner)` on the owner's `McpAuthorizationObject` shard (Node: the SQLite MCP shard), whose MCP grants and tokens are otherwise kept after access ends (R1-H4). These are new ports; verify the store placement during DX-3. Device grants are erased the same way. | Access has already ended at E2. This removes the *records*, which are personal data. |
| **E4 drain** | Call `brokeredSeveranceDrain`, `integrationEventsAlarm`, `eventBusSweep` and the connection cascade drains directly (the alarm no longer runs them once fenced) until each outbox is empty, each with a bounded retry. Give up after 72 h, logging the count dropped. | Severance notices ask integrations and buses to delete their copies. The wipe would otherwise destroy the outbox. Security does not depend on delivery (E2). |
| **E5 vectors** (existing, tightened) | `purgeSearchVectors`. When `search-vector-revision` rows exist but the vector index is unavailable, owner deletion **holds**. Today's code sets `vectorIndexUnavailable` and continues, which leaves embeddings in Vectorize that nothing can enumerate after the wipe (R1-M10). Inactivity purge adopts the same hold. | Rows that name vector IDs must outlive the vectors. |
| **E5b email bridge** | `emailBridge.erase(owner)`: delete the owner's `EmailBridgeObject` instance (`owner/<uuid>`) with its settings, holding queue (inbound message content), dedup and reply ledger, via `deleteAll`. Sender-shard suppression rows are keyed by external sender, not the owner, so they stay. A no-op when the bridge was never enabled; Cloudflare-only, so Node has nothing to erase (R1-H4). | It is first-party storage of the owner's mail; privacy §8 promises its removal. |
| **E6 exports** | `exports.cancel` for every job; delete exact part keys; clear `export/active`. Deferred garbage becomes collectable. | Before the blob stages, so deferred refs are deleted too |
| **E7 archive, E8 blobs** (existing) | delete owned refs (`messages/<owner>/`, `objects/<owner>/` only, `ownedBlobRef`); foreign refs are counted, never touched | unchanged. External connector objects are never addressed. |
| **E9 billing-anonymize** | `customers.deleteExternal(owner,{anonymize:true})` (Polar SDK), if Q3 is accepted. Failure holds before the wipe. | After revoke, so financial records stay reconcilable until now. Polar keeps orders as tax law requires. |
| **E10 notice** | completion email to the snapshot address; push to the snapshot devices | Last point at which the address still exists |
| **E11 metadata** (existing, via `beforeWipe`) | delete `ARCHIVES accounts/<owner>.json`; remove the `deletion-due` index row; write `lifecycle/tombstone-v1 {reason, basis, requestedAt, deletedAt, counts}`; `purgeAll({keep:['owner',TOMBSTONE_KEY]})` | The tombstone is written before the wipe, so a crash never leaves a rebuildable empty account |

Operations declared `lifecycle:'purging'` must not declare `warm:true`. A warm during E7–E11 would restore archived rows from an object the executor is deleting.

**Why the identity tombstone comes earlier than the brief's order.** The brief puts the tombstone last. In the current executor it is already the access fence: it ends sessions, credentials, recovery and app lineage in one revision-checked CAS. Doing it last would leave identity-level actions possible across hours of content deletion, such as adding a passkey, linking an email or approving a device. The account DO fence (E0) only covers account operations. Billing goes first because it is the only effect that can *create new obligations* after deletion.

**Crash points and recovery:**
- **Between commit and E2.** A fresh sign-in may create a session at identity, but every account operation returns 410. E2 deletes the session.
- **During E2.** The tombstone CAS retries. `account.status==='deleted'` returns true (idempotent). An `assignmentId` mismatch throws `lifecycle_assignment_changed` and holds.
- **After E11 started.** If the wipe completed but the tombstone key was lost, the existing `lifecycleTick` restore path rebuilds `owner` plus the tombstone from the identity tombstone. That path is currently conditional on `lifecycleMode!=='off'`, so DX-3 makes it unconditional when the identity is `deleted`. It writes the reason from the identity tombstone's `account-deleted-<reason>` audit event instead of a hard-coded `inactive-unpaid` (R1-L1).
- **Empty-DO resurrection** (R1-M7). The Worker's non-`purgeAll` branch issues `deleteAll()` and the tombstone `put` concurrently, and storage can also be lost. Either way an account object may end up with no `owner` key for a deleted identity. Today any initialising path, such as `ensureBuiltinStorage` through `admitWork({initialize:true})` or `warm`, would re-create `owner` and an Inbox, because `lifecycleBlocked` checks only `TOMBSTONE_KEY`. So `lifecycleBlocked`, whenever `owner` is absent, asks the identity port for status once. If the identity is `deleted`, it writes `owner` plus the restored tombstone and answers `account_deleted`. The lookup costs one call per object lifetime and only before first materialisation.
- **Webhooks during and after deletion** (R1-L2). The route already ignores events for an identity whose status is `deleted` (`routes/billing.mjs`), and `billingWebhookVerified` is already `lifecycle:'purging'`, so events during execution are accepted and later wiped. DX-4's hunk is therefore narrower than first written: a `subscription.created`/`subscription.active` or `order.paid` event for an owner whose identity is `deleted`, or whose account holds `deletion/fence-v1`, triggers `revokeAll` and an operator alert instead of a silent ack. A deleted account must never carry a live subscription.

**Node parity.** The same engine operations and `purgeBatch` run over `SqliteMetadata` and `FileBucket`, with the Node account alarm emulation (`setAlarm`) and the Node scheduler. The tests in §8 run on both, plus one workerd test of alarm continuation.

Two Node gaps must close first (R1-M9):
- `FileBucket.get` reads the whole file and offers no `body` stream and no `range`. It gains `get(key, {range:{offset,length}})` returning `{size, body: ReadableStream}`, read with `fs.createReadStream({start, end})`.
- The `digest` provider replaces `crypto.DigestStream` (§1.2).

Node has no Vectorize, email bridge or BindleBox, so E5 and E5b are no-ops there, while the MCP SQLite shards are erased at E3.

### 2.4 Others' contact links and delivered messages

- **Delivered messages and conversation copies** in other accounts stay theirs. Deletion cannot retract copies (security.md, Trust boundaries). No automatic `retract` is sent: it would be lossy for recipients and cannot be guaranteed. The confirmation screen says so, and owners can delete or retract their own items before requesting deletion.
- **Contact links and capabilities that others hold** keep pointing at an account that now answers exactly as an unknown or invalid one would on every delivery, preview or resolution: a uniform 404 on link, delivery and delegation-status lookups, matching [organizations §3a.2](../spec/organizations.md#3a2-handle-lookup) on directory and identity-document lookups. Public surfaces never answer `410` or expose `status:'deleted'` (rule RR1-R1 in [app uninstall §7.5a](app-uninstall.md#75a-what-deleted-identities-answer-404-not-410-rr1-r1); provisional, unsigned). `410 account_deleted`/`account_deleting` stays on owner-authenticated surfaces only.
  - Why: a distinguishable answer would let anyone holding a handle or link confirm that a particular person deleted their account, and after a move's redirect period ends the source answers for a moved identity exactly as for a deleted one ([identity portability](../spec/identity-portability.md)), so a "deleted" answer would mislabel people who moved. Peers see the contact as no longer reachable, not as deleted.
  - U404 closes the deletion-fence gap: before E2 tombstones the identity, a signed contact delivery may still reach `lifecycleBlocked`, but the public boundary conceals its fault with the same 404 as an unknown link. Public authorization admission also checks the account engine gate. See the [route inventory and local validation scope](../release/uniform-unknown-review.md); the older contact-link `401` and unknown-delegation `revoked` exceptions are superseded by the workstream’s uniform-404 instruction. Credential surfaces (app tokens, capabilities, grants, client proofs) keep their standard protocol refusal, and a credential whose own account is deleted is simply invalid ([app uninstall §7.5a](app-uninstall.md#75a-what-deleted-identities-answer-404-not-410-rr1-r1)).
  - Because names are never reassigned, the old link can never reach a new person.
  - No outbound fan-out to contacts is needed or sent.
- **Issued contact grants** die with the account store. Pending outbound deliveries in our outbox are dropped at the wipe; their receivers' replay fences expire normally.
- **Apps' copies** of granted data stay with the apps (security.md S1). Integrations receive `connection-revoked` (terminal) from the E2 severance and, where `subject-deleted.v1` is declared, a `subject-deleted` event enqueued in the same transaction and dispatched by E4 no earlier than `access_ends_by` ([app removal §8](../spec/app-removal.md#8-subject-deletion), proposed). The SET wire carries no reason member.
- **Public keys** are not retained on the tombstone; this is the current `RETAINED` list. Verifiers of past signatures see the same uniform answer as for an unknown identity. Retaining them would add data that privacy §8 does not list.

### 2.5 What is retained, and why

| Retained | Where | Why | Privacy §8 |
|---|---|---|---|
| id, handle, assignmentId, internal markers (`systemIdentity`/`onboardingIdentity`), createdAt, deletedAt, status | identity tombstone (`RETAINED`) | names are never reassigned ([identity-names](../spec/identity-names.md)) | listed; **add "when it was deleted"** |
| paid alias and namespace claims | the permanent claim ledger (`identity-namespace/*`, `identity-paid-handle/<owner>` anchor), **not** the tombstone: `paidHandle` is not in `RETAINED` (R1-L1). The claim stays bound to the retained `assignmentId`, so `findByHandle` still resolves the alias to the deleted identity. | names are never reassigned | listed |
| `owner` plus the tombstone (reason, basis, requestedAt, deletedAt, counts) | account store | refuse every later operation with 410, and serve as a minimal erasure receipt | **add** to §8 ("a record that the deletion happened and when") |
| `lineageOutbox` until delivered | identity tombstone | app-family revocation delivery | covered as app authorizations |
| Admin audit entries (actor, action, target UUID, masked email) and the admin principal row (roles, holds, `closure`) | admin store, hash-chained | the audit chain cannot be edited ([boot-and-admin](boot-and-admin.md)); the principal row carries holds that must outlive the identity | **add** ("records of administrative actions on your account") |
| Payment event records linked to the account ID | billing catalog store (refund resolution) | 35 days, as privacy §3 states | listed (35 days) |
| A waitlist row with the same address, if any | waitlist store, address-sealed, not linked to the account | its own retention: until left, or 180 days after confirmation. The deletion confirmation screen links "leave the waitlist" | listed separately in §8; **say so** in the deletion paragraph (R1-L10) |
| Rate-limit counters and daily experiment keys | abuse guard; flag statistics | at most 24 hours; daily HLL keys are deleted at rollup (feature-flags §7) | listed |
| Polar orders (anonymized if Q3) | Polar | tax law | listed |
| DO point-in-time recovery (up to 30 days), mail-provider logs and suppression lists, push-service state | providers | — | "Backups" paragraph; be specific in the final text |
| Data others or apps hold; external storage | third parties | outside our control | listed (connected storage), add recipients' copies |
| BindleBox mailbox data | BindleBox's `MailboxObject` (separate Worker, same operator) | **open, R1-M12**: today it marks its authorization inactive on `connection-revoked` but keeps the mailbox | not covered; needs a decision |

The legal owner, not this slice, should make the three wording additions to privacy.md. Until then, this table is the reconciliation record.

### 2.6 Admin-assisted path (email requests)

Privacy §9 lets people write to contact@3sln.com from the confirmed email. A `From:` header is not proof. The authority chain is:

1. An administrator looks the user up by exact handle, UUID or verified email. This is an existing audited operation, which returns a masked email.
2. **`users.request-deletion`**, a new `AdminService` operation:
   - it is built-in `admin` only; it is not a user-class capability and not delegable;
   - it needs a fresh step-up (5 min), the per-actor rate window, and the typed target handle;
   - targets that hold `admin` or are internal need boot, matching the suspension rule;
   - it uses the cross-store pattern: an `intent` audit entry, then the account call, then `applied`/`failed`;
   - **effect:** send a confirmation link to the account's *own* verified email, never to the sender.
3. Opening the link and confirming (`POST`, with the same checklist as §2.1) schedules deletion with `basis:'admin-email'`, a **30-day** grace, the normal notices and cancel. Possession of the confirmed email is the same authority as email sign-in. The user needs no credentials, which is the usual reason for writing in.
4. An account with no verified email cannot be verified this way. The admin replies that the person must sign in, or use recovery and then self-serve.
5. **Email sign-in disabled** (R1-M3). If `emailLoginEnabled` is false, the link is refused, and the reply directs the person to recovery. An owner who turned email sign-in off has said that the mailbox alone is not authority over the account. Recovery is always available, because the recovery file is mandatory.

Admin bases without user confirmation:
- **Underage** (privacy §10): `basis:'admin-underage'`.
- **Closure** (terms §10): `basis:'admin-closure'`, via §4.2.

Both need the typed handle and a reason. Both run the same grace and notices, with provider acceptance required before execution. Neither can be cancelled by sign-in; appeal goes through contact@3sln.com.

## 3. Email removal

`IdentityService.emailRemove(input, context)` is wire `identity.email-remove`, exposed as `POST /api/identity/email/remove`.

- **Authority:** `privileged(context, 300000)` (step-up) plus CSRF, and `input.confirmed===true` (R1-M2). It bumps `security` in the same CAS (§2.1).
- **Channel check.** The account DO reports its verified, available push subscriptions through a port (`channels(owner)`, reusing the lifecycle `contactReady` rule). If none exists, the removal is refused with `last_notice_channel`, **unless** `input.waiveNotice===true`. The waiver records `noticeWaiver:{at, termsVersion}` on the identity (Q4).
  - Recovery does not depend on email: credentials and the recovery file are mandatory.
  - Email sign-in, if enabled, is disabled in the same CAS.
- **Effect** (one CAS):
  - `verifiedEmail=null`, `emailVerifiedAt=null`, `emailLoginEnabled=false`;
  - `emailChallenges=[]`;
  - audit `email-removed`.

  Outstanding login links fail, because `emailLoginConfirm` already requires `challenge.email===account.verifiedEmail`.
- **Index cleanup:**
  - *Unsharded repository:* `compareAndSwap` already deletes `email/<old>` when `verifiedEmail` changes ([accounts.mjs](../../packages/runtime/accounts.mjs)).
  - *Sharded repository* ([identity-shards.mjs](../../packages/runtime/identity-shards.mjs)): `linksFor` omits the email link when `verifiedEmail` is null, so prepare/commit releases the `identity-lookup/email/<addr>` claim. A crash between the phases leaves a stale lookup. `find(kind, value, 'account', 'verifiedEmail')` checks the record field, so a stale lookup never resolves, and the next verification by any account reclaims it. Tests in §8 prove both behaviours.
  - **Other address-keyed state:**
    - waitlist rows keep their own retention (privacy §8);
    - notification email budgets and unsubscribe tokens are account-keyed and invalidated;
    - the lifecycle channel `revision` changes, so any open notice episode follows the existing channel-change rule.
- **Notice** to the removed address ("Your email was removed from @handle. Not you? Sign in and secure your account"), and push to the remaining devices.

## 4. Over-quota and closure export hooks

### 4.1 Over-quota (terms §7, D092)

When a D092 retention episode enters `grace`, the owner may create one `exports.create({purpose:'over-quota', episodeId})`. It needs a fresh step-up, like any export, but it is exempt from the 2-per-7-days cap. That allowance resets only with a new episode.

Every episode notice carries the export link. D092 phase 1 connects the verified billing-transition producer to the account-owned episode and records `exportOffered:{at, jobId?}` through `export-hooks.mjs`; creating the owner export attaches its job evidence to that episode. This records availability, never acceptance or delivery. `cleanup-eligible` is computed only: no D092 executor exists and phase 1 removes no user data.

The producer and owner visibility use `retention.produce`, `retention.status`, `retention.keep` and `retention.view`; operator catalog notice dates and independent transport evidence use system-only `retention.catalog-notice` and `retention.notice-result`. Catalog notice adoption remains possible after the transition was consumed without an episode, and never extends an existing funded cutoff. Physical retained-byte accounting remains unknown (`physicalRetainedBytes:null`); paged transactional inventory does not establish million-item scalability.

Deferred garbage (§1.4) means a unit pinned by a `ready` export is physically reclaimed only after that export expires. The expiry is at most 7 days, which fits within D092's single 7-day extension cap. Live retention is not extended.

### 4.2 Closure (terms §10)

`users.close` is a new admin operation, built-in `admin` with step-up, reason and typed handle. It does all of:
- sets identity status `suspended`, ending sessions and disconnecting apps, as suspension does today;
- records `closure:{basis, exportUntil}` on the admin principal. It does **not** record an ordinary admin hold (R1-M8);
- schedules deletion with `basis:'admin-closure'` and `executeAfter=exportUntil`. The default is **30 days**, the "reasonable opportunity".

During that window, credential sign-in for a closed account yields a **restricted session**, `scope:'closure-export'`. It is accepted only by `exports.*`, `deletion.status` and sign-out. It reuses the restricted-authentication idea lifecycle suspension already has, but on the identity side, because admin suspension blocks `authorized()`.

When "law or safety prevents it", the admin sets `exportUntil=null` with a reason. The notice then says no export is offered.

**Hold semantics for admin bases** (R1-M8). `lifecycleAdminHoldPort` treats every `suspended` identity as held, and suspension records an admin hold on the principal. A closure or underage deletion would therefore be frozen forever by its own suspension. The deletion fence instead uses `deletionHold(owner)`, which returns `AdminService.lifecycleHold(owner)` alone. Status `suspended` never holds deletion. Because `users.close` sets the status without recording a hold, the closure's own suspension does not freeze it. A legal hold placed later still pauses execution. Reactivating a closed account (an admin decision to reverse closure) cancels the scheduled deletion.

**Ending the Service** (60 days' notice): this is an operator runbook item, not code. Raise export caps globally through the flag console and keep download routes up until the end date.

## 5. Security review points

| Threat | Mitigation |
|---|---|
| Account takeover, then deletion | Step-up (a stolen session cookie is not enough), typed handle, 14-day grace (30 after a recent security change, read from the non-rotating `security` state), notices to the channel *snapshot* (copied endpoints) with a cancel-only link in both email and push that needs no sign-in, at least one provider-accepted notice before commit, an interstitial on the owner's next sign-in, and a deadline that moves to at least 14 days after any security change made during grace (including the owner's own recovery). An attacker who also replaced or removed the email inside the 72 h window triggers the 30-day grace, and the notice to the removed address (§3) gives the owner a lead. |
| Attacker cancels the owner's deletion | Harmless: cancel is the safe direction. The owner re-requests. |
| Attacker uses the cancel link to probe | It is a 256-bit hashed token, single purpose, POST-only, rate-limited, and gives no account data. |
| Grace period abused to keep using a "deleted" account | Deletion is the owner's choice; grace costs only storage, and nothing is promised beyond 14 or 30 days. |
| Race: sign-in versus deadline | One account transaction decides (§2.2). Identity sessions created in the window die at E2 and can never reach account data (410 fence). |
| Admin-path social engineering | Confirmation goes only to the address on file. The `From:` header is ignored. The audit chain and rate window apply. Admin, internal and boot targets are protected as for suspension. |
| Export as an exfiltration vector | Step-up for create and CLI grants. Notices on create and on the first download from each session or grant. A 72-hour ready-delay after a security-sensitive change (Q5), read from `security.changedAt`. One active job, two per week. Download cap of 3× the size. 7-day expiry. `security.epoch` binding, so recovery, credential reset or an email change kills downloads. Session-bound downloads with no URL tokens. Job IDs are unpredictable but confer nothing alone. No secrets or private keys in the archive. Audit rows `export-created`, `export-downloaded` and `export-cancelled` in the owner security log. |
| Export content served as HTML on our origin | `attachment`, `application/x-tar`, `nosniff`, `no-store`. Paths are fixed ASCII, and the CLI rejects traversal and collisions on extraction (D093). |
| Deletion bypassing paid protection or a legal hold | Paid protection deliberately does not apply to *owner* deletion (retention policy: "Explicit owner-requested deletion … different operations"). The admin hold **does** pause execution. |
| Partial deletion leaves a resurrectable account | Fence first. The tombstone is written before the wipe. The restore path rebuilds the tombstone from the identity. Recreating an account with the same name is impossible by the claim ledger. |
| Billing renews after deletion | `cancel_at_period_end` at request, revoke at E1 before anything irreversible, and a hold on failure. |
| Email removal hides a takeover | Step-up, a notice to the removed address, an audit entry, and a `security` bump, which starts the 30-day deletion grace and the 72-hour export delay. Removal never removes credentials or recovery. |

## 6. Interfaces to agree before coding

- `purgeBatch(c, owner, {identity, fence, budget, log, reason, basis, stages:{billingStop, eraseGrants, drain, eraseEmailBridge, exportsCancel, billingAnonymize, notice}})`. The stage hooks are injected. **Both** callers pass `eraseGrants`, `drain`, `eraseEmailBridge` and `exportsCancel`. Only owner and admin deletion pass `billingStop`, `billingAnonymize` and `notice` (R1-H3). Otherwise an inactivity purge would leave export parts in `ARCHIVES`, MCP and federation records, and the email-bridge mailbox. Stage names stay append-only in `job.stage`. A deletion job starts at `billing-stop`; a lifecycle job keeps starting at `identity`.
- `identitySecurity(owner) → {epoch, changedAt}` (identity port, R1-H1), plus `security` maintenance in every security-sensitive CAS in `IdentityService`.
- `deletionHold(owner)` (§4.2) and `deletionTick(c) → {busy, wakeAt}`, with the min-merge alarm helper (§2.2).
- `mcp.eraseSubject(owner)` and `emailBridge.erase(owner)`.
- The `deletion-due/<executeAfter>/<owner>` index in the identity directory, with `put`/`delete` through the identity port.
- `FileBucket.get(key, {range})` returning `{size, body}`, and a `digest` provider (Workers `DigestStream`, Node `createHash`).
- `lifecycleIdentityPort.tombstone(owner, {assignmentId, reason})`. The audit event is `account-deleted-${reason}`. The default is `'inactive'`, which keeps the existing value.
- `lifecycleBlocked`: also returns `account_deleting` when `deletion/fence-v1` exists, in every mode.
- `billingClosure` port: `cancelAtPeriodEnd(owner) → {set:[ids]}`, `uncancel(owner, ids)`, `revokeAll(owner) → evidence`, `anonymize(owner)`.
- `federation.eraseSubject(owner)` and `accountChannels(owner)` (push readiness for §3).
- Operation statics: `lifecycle`, `gate`, `activity` as today, plus `termsGate:'exempt'` (consumed later by the re-acceptance slice).

## 7. Open questions for the user

| # | Question | Recommendation |
|---|---|---|
| Q1 | Grace period length, and how cancellation works | **14 days; 30 days after a recent security-sensitive change.** Cancel through the sign-in interstitial (never silently) or the emailed cancel-only link. |
| Q2 | Active paid subscription at deletion | **Do not block deletion.** Set cancel-at-period-end at request (undone on cancel) and revoke at execution. No automatic prorated refund; refunds follow `[REFUND POLICY]` and consumer law, handled manually through Polar. The confirmation screen says so. |
| Q3 | Delete the Polar customer on account deletion? | **Yes: `customers.deleteExternal(owner, {anonymize:true})`** at E9, after revoke. First verify in the Polar sandbox that anonymization keeps orders for tax purposes and clears `external_id`. |
| Q4 | Email removal when no push channel exists | **Allow it with an explicit notice waiver.** For a waived free account, the inactivity lifecycle may proceed on in-app notice only, with doubled grace. This needs a sentence in privacy §8 and terms §9. Until that text is approved, keep today's behaviour: no verified channel means the destructive steps hold. |
| Q5 | Delay export readiness 72 hours after a security-sensitive change? | **Yes.** It is the single strongest exfiltration brake. A legitimate owner who just recovered waits 3 days and is told why. |

## 8. Slices, flags and tests

### 8.1 Flag registry rows

Write ownership: FF-1 has landed (`packages/flags/registry.mjs` exists), so these rows go in as a **coordinator hunk** after FF-2 settles its seed and snapshot tests. That hunk includes any count or snapshot fixture in `tests/flags-registry.test.mjs`. They are not added by this design. The `gates` override narrows the default `RELEASE_GATES` list, so FF-8's registry↔open-items sync check must accept it (R1-M11).

```js
['ACCOUNT_EXPORT_ENABLED','a','G A S P',{risk:'crit',stateful:true,envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','durableStorageAndArchiveRecoveryVerified','notificationTransportsVerified','securityRedTeamFindingsResolved']}],
['ACCOUNT_DELETION_ENABLED','a','G A S P',{risk:'crit',stateful:true,envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','lifecycleNoticesAndDeletionVerified','emailLifecycleVerified','notificationTransportsVerified','durableStorageAndArchiveRecoveryVerified','securityRedTeamFindingsResolved']}],
['EMAIL_REMOVAL_ENABLED','a','G A S P',{risk:'crit',envParse:'boolean',
  gates:['termsAndPrivacyApproved','realBrowserFlowsPassing','emailLifecycleVerified','lifecycleNoticesAndDeletionVerified']}],
```

All three default to `safe:false`. There are no experiments and no R dimension (stateful).

`hasState`:
- for export, "has an export job";
- for deletion, "has a scheduled or executing request".

With `retainExisting`, an owner's existing job or request stays serviceable through ramp-downs.

What the flags do *not* gate (feature-flags §0.7, §4):
- `exports.cancel`, `exports.status` and downloads of an existing ready job;
- `deletion.cancel`, `deletion.cancel-token`, `deletion.status`;
- `deletion.step` and `exports.step`, which follow only an env kill (`"false"`). An env kill halts background execution *between stages* and keeps data; it never rolls back. A committed request stays fenced (410) and cannot be cancelled while killed, so the operator runbook treats a kill of more than a few days as an incident. The erasure deadline (privacy §9, one month) keeps running (R1-L11).

Admin `users.request-deletion` and `users.close` require `ADMIN_ENABLED` and the deletion flag's global component.

### 8.2 Slices

Write ownership does not overlap. *Coordinator hunks* are one-line registrations or the gated edits named below, applied by the coordinator so that files currently owned by flags, signup or web work are not shared.

**Carve-outs from FF globs** (R1-M11). FF-5a owns `packages/runtime/routes/**`, FF-5b owns `packages/runtime/account/**`, and FF-4 owns `apps/node/resources.mjs`. The new DX files below sit inside those globs, so they must be agreed as exclusions with the FF-5a/FF-5b owners before either side starts:
- `routes/exports.mjs` and `routes/deletion.mjs`;
- `account/exports.mjs` and `account/deletion.mjs`.

FF-5a/5b do not create those names. Flag reads inside them are DX's own and use `flags.for(ctx)` from FF-4. Until FF-4 lands, DX engine code takes the `flags` provider from FF-3's catalogue row and is tested with memory providers. The raw-env guard test (FF-5c) applies to DX files as well.

| Slice | Scope | Files owned | Depends on |
|---|---|---|---|
| **DX-1** Export core | contributors, inventory completeness, generation (outside the gate), small-payload packs, `digest` provider, deterministic tar layout and range mapper, stream-time size checks, sealing, expiry | `packages/app/domains/account-export.mjs` (new), `packages/runtime/export-generation.mjs` (new), `packages/runtime/export-tar.mjs` (new), `packages/runtime/export-contributors.mjs` (new), `tests/engine-account-export.test.mjs`, `tests/export-tar.test.mjs`, `tests/account-export-chaos.test.mjs` | §6 interfaces (incl. `identitySecurity`); FF-3 `flags` provider row; registry rows (coordinator) |
| **DX-2** Export wiring and download | account slice, HTTP routes, edge streaming, CLI grant, exact-ref pin module | `packages/runtime/account/exports.mjs` (new; carve-out), `packages/runtime/routes/exports.mjs` (new; carve-out), `packages/runtime/export-pins.mjs` (new), `tests/exports-http.test.mjs`, `tests/worker/exports-stream.test.mjs`. *Coordinator hunks:* registration in `routes/index.mjs` and `account/index.mjs`; route all physical deletes through `blob-garbage/` and call `export-pins` in `collectBlobGarbage` in `accounts.mjs` (after FF-5b lands); `FileBucket.get(key,{range})` streaming in `apps/node/resources.mjs` (after FF-4 lands) | DX-1; FF-4 |
| **DX-3** Deletion domain and executor | request, cancel, commit, fence, `deletionHold`, `deletionTick`, generalized `purgeBatch` with common erasure stages, tombstone reason, grant erasure (federation and MCP), email-bridge erasure, drain, unconditional restore path, empty-object identity check | `packages/app/domains/account-deletion.mjs` (new), `packages/runtime/account-deletion.mjs` (new), `packages/runtime/account/deletion.mjs` (new; carve-out), `packages/runtime/lifecycle-storage.mjs`, `packages/identity/lifecycle-tombstone.mjs`, `tests/engine-account-deletion.test.mjs`, `tests/account-deletion-chaos.test.mjs`, `tests/worker/account-deletion.test.mjs`. *Coordinator hunks* (after FF-5b): `lifecycleBlocked` fence and empty-object checks, the restore-path condition and the `deletion-scheduled` hold in `lifecycle-runner.mjs`; in `accounts.mjs`, `alarm()` calls `deletionTick` first, returns early while fenced or purging, and re-arms through the min-merge helper, and shelving and semantic backfill refuse while a request is scheduled; the `deletionTick` sweep call in `packages/runtime/lifecycle-scheduler.mjs`; `federation.eraseSubject` in `packages/federation/service.mjs`; `eraseSubject` in `packages/mcp/runtime.mjs`; `erase` in `packages/email-bridge/owner.mjs` | §6; DX-4 port |
| **DX-4** Billing closure | cancel-at-period-end, uncancel-own (with `canceled_at` match), revoke, open-checkout check, anonymize, evidence; revoke-and-alert on new paid events for deleting or deleted owners | `packages/billing/closure.mjs` (new), `tests/billing-closure.test.mjs`. *Coordinator hunks:* the new-subscription alert in `packages/runtime/routes/billing.mjs` (after FF-5a); the `deletion_scheduled` refusal for `billingCheckout`/`billingChangePlan` in `packages/runtime/account/billing.mjs` (after FF-5b) | Q2, Q3 |
| **DX-5** Deletion HTTP and notices | `/api/account/deletion` routes, cancel-token page, notice templates (mail and push, both with the cancel link), step-up wiring | `packages/runtime/routes/deletion.mjs` (new; carve-out), `packages/runtime/deletion-notices.mjs` (new), deletion i18n strings in a new `packages/i18n` catalogue file, `tests/deletion-http.test.mjs` | DX-3 |
| **DX-6** Email removal and security state | `emailRemove`, channel port, waiver, sharded-lookup tests; the `security:{epoch, changedAt}` field bumped in every security-sensitive CAS and the `identitySecurity` port (R1-H1) | `packages/identity/service.mjs` (one new method plus the `security` bumps, after the current uncommitted legal/age edits to that file land), `packages/runtime/account-channels.mjs` (new), `tests/identity-email-removal.test.mjs`, `tests/identity-security-state.test.mjs`. *Coordinator hunk:* route in `routes/identity.mjs` | Q4 for removal only. The security state does not depend on Q4 and lands first, because DX-1, DX-2 and DX-3 read it. |
| **DX-7** Admin-assisted deletion and closure | `users.request-deletion`, `users.close`, restricted closure-export session | `packages/identity/admin.mjs`, `packages/runtime/admin-http.mjs` (route hunk), `tests/admin-deletion.test.mjs` | DX-3, DX-5; boot-and-admin rules |
| **DX-8** Web UI | "Your data" screen: export, delete with checklist and typed handle, email removal; sign-in interstitial; restricted closure view | `apps/web/src/{bl,ui}/account-data.mjs` (new), one export hunk in the console entry, `tests/browser/account-data*.mjs` | DX-2, DX-5, DX-6; after current `apps/web` work lands |
| **DX-9** Over-quota hook and CLI | `purpose:'over-quota'` allowance and `exportOffered` evidence (with D092 phase 1); optional `scripts/bindle-export.mjs` downloader with checkpoints and verification | `packages/runtime/export-hooks.mjs` (new), `scripts/bindle-export.mjs` (new), `tests/export-hooks.test.mjs` | DX-2; D092 phase 1 |

### 8.3 Tests

Most tests run at engine level through `createTestEngine` with seeded `faults`, `wrap` schedulers and `fakeClock` (app-engine §8). Rerun a failure with `CHAOS_SEED`.

**Export (DX-1/DX-2)**
- Inventory completeness: every written prefix is claimed or excluded with a reason.
- No secret ever appears in output. Seed the account with a password hash, recovery hash, session hash, OAuth token, S3 key, contact shared secret and push endpoint, then grep every part.
- Determinism: two layouts from one sealed manifest are byte-identical.
- Arbitrary single ranges (inside a header, across entry boundaries, at padding) equal the slice of the full stream; resume after a 200 is rejected by the CLI.
- Generation crash at every transaction boundary resumes without duplicate or missing rows. An orphan part key is overwritten.
- Payload changed or deleted mid-generation: the deferral keeps bytes, and the digest matches the manifest.
- Shelved account: `warm` restores, then generation runs. Suspended account: allowed, with no activity recorded.
- Rate limits, `notBefore` after a security change, download cap, expiry, `security.epoch` change after recovery returns 401, and cancel deletes exact keys.
- Node (`FileBucket`) and workerd stream parity: R2 reads per volume stay at or below 900.
- 100,000 small messages produce a handful of volumes through packs. Packs are deleted by exact key on expiry, cancel and E6.
- A referenced object whose size changed or that vanished aborts the stream; no padded tar is ever emitted.
- Pins: garbage for an unindexed ref is collected during an export; an indexed ref is kept. The upload-and-delete loop hits `export_pin_budget`, after which the pins are released.
- Security state: a 100-event audit flood after an email change still yields the 72-hour delay and the 30-day grace. Each listed change bumps `epoch` and kills an active download.
- A step-up older than 5 minutes refuses create and CLI-grant minting. A second session's first download sends a notice.
- Inactivity purge with a ready export: no part, pack or pin survives.

**Deletion (DX-3/DX-4/DX-5)**
- Request: step-up required, typed handle mismatch, `operationId` replay and conflict, 30-day grace after a recent change, refused while recovering.
- **Crash mid-deletion (seeded chaos):** inject an `after` fault and a process restart at every stage boundary and inside E2, E7 and E8. Invariants after convergence:
  - the tombstone is present, the identity is `deleted` with `RETAINED` fields intact;
  - the handle cannot be claimed by signup;
  - the email address can be verified by another account;
  - no `messages/<owner>/` or `objects/<owner>/` blob remains, and foreign refs are untouched;
  - Polar `revoke` was called at least once and its result is idempotent;
  - the federation subject is erased, and no export part key remains.
- **Concurrent export and delete:** with a seeded scheduler, interleave `exports.step` with request, commit and E6.
  - No export part survives.
  - `export/active` is cleared.
  - Deferred garbage is collected.
  - An `exports.create` after commit returns `account_deleting`.
  - Cancelling deletion leaves a ready export intact.
- **Racing sign-in during grace:** interleave identity sign-in, `deletion.cancel` and the deadline commit across 1,000 seeds.
  - Exactly one of `cancelled` and `executing` wins.
  - If cancel wins, no billing, identity or blob effect ran, and our `cancel_at_period_end` is undone.
  - If commit wins, cancel returns 410, and a session created in the window is gone after E2 and never reads account data.
- Admin hold placed mid-execution halts before the next destructive stage, and release resumes it.
- Alarm isolation: with the fence set and `lastOwnerActiveAt` older than 7 days, no shelving, semantic backfill or conversation drain runs. Shelving forced between E7 and E8 is caught by E8's re-check, and no owned blob survives.
- Wake invariant: a maintenance-retry `setAlarm(+7 d)` never moves the alarm past `executeAfter`. With the object's alarm deleted, the sweep still commits a due request.
- Empty object: wipe the object's storage after E2; a later `admitWork({initialize:true})` answers `account_deleted` and creates no Inbox.
- E5 with the vector index unavailable holds; it does not continue to the wipe.
- E3 erases MCP grants; E5b leaves the bridge object empty.
- Notices: deleting push-subscription rows after the request does not stop push notices. With no accepted notice, commit holds. A recovery during grace moves `executeAfter` to at least the recovery time plus 14 days.
- Closure: a suspended, closed account executes at `exportUntil`. A legal hold placed afterwards pauses it.
- Request refused for an identity holding `admin`. `admin-email` is refused when email sign-in is disabled.
- A Polar outage at E1 holds with backoff and never reaches E2. A Polar outage at E9 holds before the wipe.
- Drain: severance outbox delivered, or dropped after 72 h with a count.
- Wipe restore: a deleted identity with an empty DO rebuilds the tombstone in lifecycle mode `off`.
- Terms re-acceptance pending: request, cancel and export still succeed.
- Billing webhook for a deleted owner returns 2xx and changes nothing, except that a new-subscription or paid-order event triggers `revokeAll` and an alert. An open checkout holds E1 until it expires.
- Node and workerd alarm continuation of a long purge (budget 64 refs, thousands of refs).

**Email removal (DX-6)**
- Refused when it is the last channel without a waiver; succeeds with one push subscription.
- The waiver is recorded; email login is disabled; outstanding login links fail.
- Unsharded index deleted.
- Sharded: crash between prepare and commit leaves a stale lookup that does not resolve and that another account reclaims.
- Lifecycle channel revision changes. A notice is sent to the removed address.

**Admin (DX-7)**
- Non-admin or delegable roles are refused; admin targeting an admin is refused; boot is allowed.
- Step-up and rate window enforced; the audit chain verifies.
- The confirmation goes only to the address on file. No verified email returns a refusal.
- Closure: restricted session reaches only export, status and sign-out, and deletion runs at `exportUntil`.

## 9. Reconciliation notes for DEVLOG (coordinator)

These are proposed entries. None are signed.
- The identity tombstone moves to stage E2 in owner deletion, deviating from the brief's order (§2.3).
- Browser downloads use session-bound `GET` instead of a presigned URL (§1.6).
- Export gains `lifecycle:'suspended'`, which changes the lifecycle restricted list.
- privacy.md §8 needs three wording additions (§2.5).
- [docs/legal/README.md](../legal/README.md) "Commitments" rows for deletion, export and email removal move to "designed; flag-off" only when DX-3, DX-2 and DX-6 land with tests. Until then they stay blockers.

## Review round 1

Independent adversarial security and architecture review, 2026-10-21, checked against the code at `8db91ac` plus the uncommitted working tree. Reviewer: Claude (agent); not a human sign-off. Each finding below has a failure scenario and a fix. **Resolved** means this document now contains the fix, not that the fix is implemented. **Open** items need a decision outside this review.

Counts: **4 High, 12 Medium, 11 Low.** 26 are resolved in the text above; 1 is open (R1-M12).

### High

**R1-H1. The security-change window can be flushed. Resolved** (§2.1, §1.6, §8.2 DX-6).
- *Scenario:* An attacker with the password changes the verified email, then signs in and out about fifty times. `IdentityService.audit` keeps the last 100 entries, and `session-created`, `session-closed` and `step-up` are all logged. The email change scrolls out of the log, so the request gets a 14-day grace, not 30, and an export is ready at once instead of after 72 hours. Separately, the `identityEpoch` that the download route relied on does not exist anywhere in the identity code.
- *Fix:* a dedicated `security:{epoch, changedAt}` on the identity, bumped in the same CAS as every listed change and read through `identitySecurity(owner)`. Grace length, the export delay and the download binding all use it. DX-6 owns it, and it lands first.

**R1-H2. The account alarm keeps working through a fenced deletion. Resolved** (§2.3).
- *Scenario:* An owner has been inactive for 7 days. Execution reaches E7 with nothing shelved. In the same `alarm()` invocation, the code after `lifecycleTick` shelves `message/` and `resource/` rows into `ARCHIVES`. E8 scans live rows and misses them, and E11 deletes the archive envelope. The blobs those rows named stay in `BLOBS` forever: stored files survive deletion, contrary to privacy §8.
- Likewise, `backfillSemanticSearch` after E5 writes new Vectorize embeddings, and nothing can enumerate them after the wipe. The existing inactivity purge has the same defect, because `alarm()` returns early only when the result is `deleted`.
- *Fix:* return right after `deletionTick` while a fence or purge job exists. E4 calls its drains explicitly. Shelving and backfill refuse while a request is scheduled. E8 re-checks `shelved` and loops back to E7.

**R1-H3. Inactivity purge leaves exports behind. Resolved** (§0, §1.4, §6).
- *Scenario:* A suspended account creates an export, which §1.5 allows. The inactivity purge then runs `purgeBatch` with no stage hooks, because "Lifecycle passes none". Export parts under `ARCHIVES exports/<owner>/<jobId>/` survive, and the job record that listed their keys is wiped, so nothing will ever delete them. `exports.step` could also keep running from the alarm during the purge.
- *Fix:* the erasure stages (grants, drain, email bridge, exports) are common to both callers; only billing and notices depend on `reason`. `exports.step` runs only while no fence and no purge job exist.

**R1-H4. First-party stores outside the executor keep personal data. Resolved** (§2.3 E3, E5b).
- *Scenario:* An owner used the email bridge and an MCP client, then deletes the account. `EmailBridgeObject` `owner/<uuid>` keeps its holding queue (inbound mail content), settings, dedup and reply ledger. `McpAuthorizationObject` shard rows keep MCP grants and tokens. Both are operated by us under privacy §8, and neither is touched by any stage.
- *Fix:* `mcp.eraseSubject` at E3, and a new E5b `emailBridge.erase`. BindleBox is split out as R1-M12.

### Medium

**R1-M1. Export creation needed only recent authentication. Resolved** (§0.7, §1.6, §1.7).
- *Scenario:* Malware steals a session cookie within 15 minutes of the owner signing in. `recent()` passes, so the attacker creates an export with no security change, which means no ready-delay, and downloads it while the creation notice sits unread. §5 already claimed "Step-up".
- *Fix:* `privileged(context, 300000)` to create an export and to mint a CLI grant.

**R1-M2. Notice suppression and silent owner-basis execution. Resolved** (§2.1, §3, §5).
- *Scenario:* An attacker with a phished password requests deletion, deletes the owner's push-subscription rows (the snapshot held only IDs), and changes the password. A push-only owner then has no notice, no cancel link and no way to sign in. Because `basis:'owner'` did not require an accepted notice, execution proceeds. Email removal also needed only `recent()` and was not a "security change".
- *Fix:*
  - the snapshot holds endpoint copies;
  - push notices carry the cancel link;
  - at least one accepted notice is required whenever the snapshot has a channel;
  - a security change during grace pushes the deadline to at least 14 days after the change;
  - email removal needs step-up and bumps `security`.

**R1-M3. The admin-email path overrode an owner's choice to disable email sign-in. Resolved** (§2.6).
- *Scenario:* An owner disabled email sign-in because their mailbox is weak. The mailbox is compromised, the attacker writes to contact@ and confirms the link, and the 14-day notices go to that same compromised mailbox.
- *Fix:* refuse the path when `emailLoginEnabled` is false and point to recovery; use a 30-day grace for `admin-email`.

**R1-M4. The deadline wake can be lost. Resolved** (§2.2).
- *Scenario:* The T−1 notice alarm fires, and a maintenance failure calls `setAlarm(now + 7 days)` directly, which overwrites the earlier deletion wake. An abandoned account receives no invokes, so the deletion runs up to 6 days late, or never if the pattern repeats.
- *Fix:* re-arm with a minimum in a `finally`, route every direct `setAlarm` through a min-merge helper, and add a sweep through a `deletion-due` index that works independently of lifecycle mode.

**R1-M5. Small payloads would explode the volume count. Resolved** (§0.5, §1.2, §1.3).
- *Scenario:* An account with 100,000 short messages, at 900 entries per volume, needs 112 separate browser downloads. That is not a usable export under privacy §9.
- *Fix:* copy payloads of 256 KiB or less into 16 MiB pack objects of prebuilt tar segments, each counted as one R2 read.

**R1-M6. Global garbage deferral allowed abuse. Resolved** (§1.4).
- *Scenario:* With an export ready, an owner loops "upload 10 GB, delete". `collectBlobGarbage` skipped *all* refs while `export/active` was set, so R2 bytes grow without bound outside quota for 7 days or more, and the owner can re-create exports twice a week.
- *Fix:* pin only the exact refs the job indexed, and cap pinned bytes at quota.

**R1-M7. An empty account object for a deleted identity could resurrect. Resolved** (§2.3 crash points).
- *Scenario:* The Worker fallback runs `deleteAll()` and the tombstone `put` concurrently, or storage is lost, leaving no `owner` key. An inbound `admitWork({initialize:true})` then runs `ensureBuiltinStorage` and an Inbox is re-created, because `lifecycleBlocked` checks only `TOMBSTONE_KEY`, and the restore path runs only from the cron sweep when lifecycle is not `off`.
- *Fix:* when `owner` is absent, check identity status once and restore the tombstone if the identity is deleted.

**R1-M8. Closure deadlocked itself. Resolved** (§4.2, §2.3).
- *Scenario:* `users.close` suspends the identity. Suspension records an admin hold, and `lifecycleAdminHoldPort` also maps `suspended` to held. The fence sees a hold and the closure deletion never runs.
- *Fix:* `users.close` records no hold, and the fence uses `deletionHold` (an explicit admin hold only).

**R1-M9. Node parity gaps. Resolved** (§1.2, §2.3).
- *Scenario:* On Node, `FileBucket.get` reads the whole object into memory with no `range` or `body`, so a 2 GiB volume would buffer it all. `crypto.DigestStream` does not exist on Node.
- *Fix:* add `get(key, {range})` with streaming (a coordinator hunk after FF-4) and a `digest` provider.

**R1-M10. A missing vector index skipped embeddings. Resolved** (§2.3 E5).
- *Scenario:* The Vectorize binding is unavailable at E5. Today's code sets `vectorIndexUnavailable` and continues; E11 wipes the `search-vector-revision` rows, and the embeddings of message excerpts stay in Vectorize with no way to find them.
- *Fix:* hold at E5 whenever revision rows exist; inactivity purge adopts the same rule.

**R1-M11. Ownership overlapped with the FF slices. Resolved** (§8.1, §8.2).
- *Scenario:* DX-2, DX-3 and DX-5 create files inside FF-5a's `routes/**` and FF-5b's `account/**`. The checkout block in `account/billing.mjs` had no owner. The Node range read sits in FF-4's `apps/node/resources.mjs`. "The FF-1 owner adds rows" refers to a slice that has already landed.
- *Fix:* explicit carve-outs agreed before starting; coordinator hunks after FF-4, FF-5a and FF-5b; registry rows as a coordinator hunk after FF-2; and until FF-4 lands, DX engine code uses FF-3's `flags` provider.

**R1-M12. BindleBox data survives deletion. Open.**
- *Scenario:* BindleBox runs on our infrastructure under the same operator. On `connection-revoked` its `MailboxObject` marks the authorization inactive (`apps/bindlebox/worker/integration.mjs`) but keeps every message. After account deletion the owner's mail persists, while privacy §8 says content is kept "until you delete it". §1.5 treats BindleBox as a third-party app ("apps-held").
- *Proposed fix (needs a product and legal decision):* either
  - (a) BindleBox treats a terminal `connection-revoked` with `reason:'account-deleted'` as an erasure trigger, after its own export window, and E4 waits for its acknowledgement; or
  - (b) privacy.md names BindleBox as a separately governed app with its own deletion control.
- This is disputed because BindleBox's controller status and product boundary are not decided here.

### Low

**R1-L1. The paid alias is not on the tombstone. Resolved** (§2.5, §2.3).
- `RETAINED` omits `paidHandle`; the alias survives in the claim ledger and anchor instead, which is correct, but the table said otherwise.
- The restore path also hard-codes `reason:'inactive-unpaid'`. It now reads the identity tombstone's event.

**R1-L2. Webhooks and checkouts. Resolved** (§2.3 E1 and crash points; DX-4).
- The route already ignores deleted identities, and `billingWebhookVerified` is already `lifecycle:'purging'`.
- The real gap was a checkout opened just before the request, or a new subscription event after E1. E1 now holds until open checkouts expire, and a paid event for a deleting or deleted owner triggers revoke and an alert.

**R1-L3. Subscription edge cases. Resolved** (§2.1).
- A period may end during grace and cannot be restored on cancel; the owner is now told before requesting.
- Uncancel matches `canceled_at`, so it does not undo a later owner cancellation made in the portal.
- A Polar failure at request time is retried by `deletion.step`.

**R1-L4. Cancel-link expiry. Resolved** (§2.1).
- The link expired at `executeAfter` even while commit was held. It is now valid while the request is `scheduled`.

**R1-L5. Tar alignment and integrity. Resolved** (§1.2).
- A metadata size that differs from the R2 size, or a vanished object, would misalign every later header. Sizes now come from the R2 object, and the stream aborts on mismatch.
- `FixedLengthStream` with an exact `Content-Length`.

**R1-L6. CLI grant lifetime. Resolved** (§1.6).
- A 5-minute grant cannot cover hours of resumable download. The lifetime is now `min(24 h, expiry)`, revocable, epoch-bound, with a notice on mint.

**R1-L7. Silent later downloads. Resolved** (§1.4, §1.6).
- A notice went only on the first download overall. There is now one per new session or grant.

**R1-L8. Lifecycle levels of `deletion.*`. Resolved** (§2.1).
- They were unspecified. Request and status declare `suspended`; the cancels and the step declare `purging`.

**R1-L9. Self-deletion of administrators or system identities. Resolved** (§2.1).
- A takeover of an admin account could delete the operator's own access path. The request is refused while the identity holds `admin` or system provenance.

**R1-L10. Gaps in the retained-data table. Resolved** (§2.5).
- Added: the admin principal row, payment event records (35 days), a waitlist row with the same address, and rate-limit and experiment keys.
- The privacy deletion paragraph should mention the waitlist. That wording is for the legal owner.

**R1-L11. Env kill strands committed requests. Resolved** (§8.1).
- A killed executor leaves a committed account fenced and uncancellable. The runbook now treats a kill of more than a few days as an incident against the one-month erasure deadline.

### Checked and found sound

The following were checked and need no change:
- The early identity tombstone at E2.
- Linearizing cancel against commit in one account transaction.
- The email index release in the unsharded `compareAndSwap`.
- `SameSite=Strict` account cookies.
- Polar SDK 2026-10 signatures: `subscriptions.revoke(id)`, `customers.deleteExternal(external_id, {anonymize})` and `checkouts.list({external_customer_id, status})`.
- Immutable `objects/<owner>/<id>/<version>` and `messages/<owner>/<id>` keys.
- `purgeAll` on Node.
- Flag statistics, which keep only per-day HLL keys.
- Abuse counters, which expire within 24 hours.
- Waitlist rows, which are unlinked from the account and have their own disclosed retention.

### Can DX implementation start?

Yes, in this order and scope:
1. **Now:** the DX-6 security-state part, DX-1 at engine level with FF-3's `flags` provider and memory providers, the engine and executor halves of DX-3 in owned files (`lifecycle-storage.mjs`, `lifecycle-tombstone.mjs`, new files), and DX-4.
2. **First, agree** the §6 interfaces (`identitySecurity`, `deletionHold`, `deletionTick`, the erase ports and `FileBucket` range) and the FF-5a/FF-5b carve-outs.
3. **Wait for FF-4, FF-5a and FF-5b:** DX-2 wiring, DX-3's coordinator hunks, DX-5 and DX-8.
4. **Before any deletion flag is enabled, even locally:** decide R1-M12.

## DX-10 integration status — 2026-10-22

Local implementation only; no deployment, secrets, publication or production verification. Reviewer ___ / Date ___ / Outcome ___. No approval is inferred. DEVLOG.md was read but left unchanged under this workstream's explicit instruction.

| Backlog item | Status | Evidence / remaining dependency |
|---|---|---|
| DX-9 `CreateExportWithHooks`, offer/evidence registration | done-now | Account export facade and registry use the hook Action; offer remains system-only, creation owner-only. Account evidence RPC always reports `removalEnabled:false`. Existing seeded hook contention/lost-reply tests remain applicable. |
| DX-9 D092 verified episode producer and notices | phase 1 implemented provisionally, 2026-10-23 | Billing reconciliation commits durable before/after entitlement transitions with authoritative effective time and causal revision. The default-off `OVER_QUOTA_RETENTION_ENABLED` producer consumes them retry-safely, persists exact deadlines and bounded anti-abuse history, projects the warning and notice-attempt results, offers the over-quota export, and exposes owner whole-unit keep selection through Engine actions, thin HTTP and the bilingual console. Malformed/configuration Free fallbacks do not establish a downgrade; catalog changes need an explicit notice date. The default notice port records `not-configured`; no messages or retention deletions occur. `exportOffered` remains availability evidence, never delivery. Physical debt, adoption/terms migration and destructive execution remain later work. |
| DX-6 item 6 notification budgets/unsubscribe tokens | deferred | Identity `emailRemove` commits in `packages/identity/service.mjs`, which is outside DX-10's write scope. Its post-commit push is conditional/best-effort and cannot be a reliable invalidation hook. This needs an identity-owned durable cleanup intent plus an idempotent account-side consumer, including retry after a committed removal loses its reply. |
| DX-6 lifecycle notice waiver | deferred | Q4 explicitly retains destructive holds until privacy/terms text is approved. No approval was found or invented. Email-removal waiver recording already exists. |
| Device grants in exports | done-now | Worker/Node owner-shard family readers feed an explicit device projection into the grants contributor. No tokens, hashes, family IDs, rotation keys or lineage capabilities leave the projection. |
| S3/WebDAV in exports | done-now, metadata-only deviation | Read-only connectors persist encrypted configuration, not host-held per-object/version mappings. Export decrypted allowlisted bucket/prefix/resource metadata only; omit endpoints (which may contain authority), credentials and external bytes. Preserve Drive object/version mappings and add folder metadata paging. Manifest states these limits. |
| DX-6 route + mutation allowlist | done-before | Existing CSRF/step-up route is `/api/auth/email/remove` (accepted DX-6 deviation), not a second `/api/identity/email/remove` alias. `emailRemove` is in the identity mutation allowlist. |
| DX-6 adapter flags/accountChannels ports | done-before | Both adapters compose flags and account RPC channel ports. |
| DX-6 account channel/security RPCs and push choice | done-before | `account/notifications.mjs` uses owner checks, `accountChannelState`, `accountSecurityNotice` and lifecycle/default configured Web Push. |
| DX-6 email template / Node parity | done-before with configured-service limitation | Worker has `email-removed`; Node uses an injected `sendSecurityAlert` mailer. A configured method is not evidence of delivery. |
| DX-8 service-worker security notices | done-before | Existing `bindle-security-notice` handler; no frontend change here. |
| DX-1 export ports/registration/Node streaming | done-before | Both adapters compose notice/contributor/security ports; Node ranged FileBucket reads and HTTP streaming already exist. |
| DX-3 injected exports.cancelAll | done-before | `account/deletion.mjs` injects real `AccountExport.cancelAll`, covering write intents/temporary objects. |
| DX-4 registration/runtime guards | done-before | Billing account facade guards purchases and handles fenced paid events through BillingClosure. |
| DX-4 operator alert transport | deferred | Existing structured-log alert remains; no operator destination/transport is configured. |
| DX-4 Q3 Polar sandbox verification | deferred | Requires external service verification; no secrets or live actions authorized in DX-10. |
| R1-M12 | done-before (decision) | DEVLOG 2026-10-22 resolves Parley as a regular storage app; operatorApps remains a no-op. BindleBox hot-state erasure is a separate app-enablement dependency. |

Previously recorded deviations remain provisional: 72-hour new-account security delay, recovery epoch bumps, same-email reverify semantics, expectedEmail, current-terms waiver, sharded write crash recovery and non-atomic channel/identity checks; durable export intents/alternating buffers/lease epochs; conservative ambiguous billing cancellation handling and broader renewable-status revocation. Existing worker deletion parity tests now run under workerd; this does not establish production provider conformance.

DX-10 validation (local shared tree, 2026-10-22): targeted export/adapter/CLI/seeded-chaos run 26/26; final adapter/projection run 15/15; Worker 78/78; UI-state 291/291; DOM, asset build and Worker dry run pass; full e2e 214 pass / 4 WebKit skips / 0 failures. Final `npm test`: 2,434 pass / 2 failures in the unowned `tests/flags-registry.test.mjs` (expects 42 flags; concurrent registry now has 43 and adds `ARTEFACT_VERSIONS_ENABLED`). No fixes were made to that workstream. An earlier unowned docs-builder collision subsequently resolved and its isolated suite passes. An initial e2e run with an incomplete asset snapshot was discarded; the reported full run used a complete snapshot.
