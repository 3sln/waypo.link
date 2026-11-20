# Independent ordered-log storage extension

Current protocol candidate, replacing prerelease provider CRDT sync. Apps own their state format and reducers; independent blobs remain separate. Local Node/Docker multi-app browser evidence exists, while complete Worker/hosted qualification and public release remain gates. Limits below describe the reference profile, not a requirement that other providers use the same storage engine.

Discovery is `waypo_logs:{version:'1',endpoint:'https://id.example/api/services/logs',scopes:['logs:read','logs:append','logs:trim']}`. Endpoint obeys existing issuer-origin/HTTPS validation. Clients normalize as features.logs. OAuth scopes are separate; old sync grants grant none, and append does not grant trim. Identity derives issuer/account/client from current verified OAuth; requests cannot choose account/client/storage route. Logs and receipts are private to that namespace. Independent waypo_blobs remains unchanged. Payload bytes are opaque; no CRDT parsing, app checkpoint, clear, delete-log or reset API.

Log IDs match `[A-Za-z0-9_-]{1,64}`. Cursor tokens are opaque base64url, 1..512 characters, cryptographically bound to issuer/account/client/log/incarnation/position. Position0 is an origin sentinel with committed=false; it never grants destructive authority. Positive cursors identify committed entries. Clients never decode/arithmetic/construct cursors. Internal positions and wire revisions are unsigned 64-bit canonical decimal strings, maximum 18446744073709551615, never unsafe JS Numbers. Refuse overflow; do not reset sequence/incarnation.

## Wire DTO

All responses no-store, bounded JSON except append request. Errors have `{error}` and explicitly documented authorized metadata; no foreign namespace leakage.

| Request | Result |
| --- | --- |
| POST endpoint `{logId}` | logs:append; create-only 201 metadata,409 log_exists. No implicit append-create. |
| GET endpoint `?after=logId&limit=N` | logs:read; lexical exclusive page `{logs:[metadata],nextCursor:null-or-logId}`. Cursor remains app-local. |
| GET endpoint/logId | logs:read; metadata. |
| POST endpoint/logId/entries | logs:append; raw application/octet-stream; required Idempotency-Key UUIDv7; optional Waypo-Expected-Head cursor.201 new / 200 replay receipt. |
| GET endpoint/logId/entries `?after=cursor&through=cursor&limit=N` | logs:read; exclusive after, inclusive through; bounded JSON range page. |
| POST endpoint/logId/trim-before `{cursor,retentionRevision}` | logs:trim; strict exclusive boundary with revision CAS;200metadata or409 retention_conflict with authorized current metadata. |

Metadata is `{logId,origin,head,floor,retentionRevision}`. Empty log: head=origin, floor=null, retentionRevision='0'. Nonempty log: head is latest committed cursor and floor first retained committed cursor. Trim cannot remove its boundary, therefore cannot empty a nonempty log. Create returns the same metadata shape. List response limit initially64 with bounded total metadata bytes.

Receipt is `{operationId,cursor,retained,head,retentionRevision}`. operationId exactly equals canonical supplied UUIDv7. Replaying a trimmed operation returns its original cursor, retained=false, never reappends. See log-semantics.md for expiry, ordering and intent hashing.

Read page is `{entries:[{cursor,operationId,data}],origin,floor,head,retentionRevision,highWater,nextCursor,hasMore}`. data is canonical unpadded base64url of opaque payload. Count and decoded bytes both bounded: initial maximum 64 entries / 256 KiB decoded total; each entry max 64 KiB. Overall encoded JSON envelope also gets an explicit finite HTTP bound. nextCursor is the last returned cursor when hasMore, otherwise null. head reports observed head; highWater is immutable inclusive snapshot bound. If through omitted, capture current head once and return it as highWater; carry `through=highWater` across pages. through may be origin to represent a stable empty snapshot even if later appends arrive. No page includes positions beyond highWater. Omitted after deliberately starts at retained floor; supplying origin requests history from creation and detects trimming. Cursor existence/binding/ordering are validated before reading; future/uncommitted/foreign tokens refused.

After trimming, an explicitly provided after cursor below the retained floor returns 410 even if it is the immediate predecessor of the floor. Origin is accepted for an untrimmed floor at position 1; through=origin remains a stable empty snapshot when after is omitted or its provided cursor is still retained. A provided stale after rejects even when through is at/before after. Omitted after deliberately starts at retained floor. If trim erases any requested snapshot range,410 log_trimmed returns `{error,origin,floor,head,retentionRevision,highWater}`; never silently skip it. If after>=through, return bounded empty page/hasMore false, after rejecting future/foreign cursors; origin through denotes empty snapshot. Reader still checks current authority and lifecycle. Any race after archive I/O must produce a coherent retained range or explicit trimmed/retry response.

Trim boundary must be positive committed cursor, never origin, synthetic head + 1 or absent boundary. Missing revision/boundary invalid. Matching revision at/below current floor may be no-op; stale revision409 even if the prior action probably succeeded. Successful advancing trim increments retentionRevision once and atomically enqueues floor/head notification. Lost response requires metadata reconciliation; SDK never silently changes boundary or trims automatically.

## Provider transport requirements

Bound bodies before parse and authorize before reading append bytes; preserve DPoP/origin validation, final authority and terminal lifecycle checks. Node and account actor HTTP implement identical contract. Signed actor leases include only new exact scopes and namespace; old scope aliases forbidden. Strip native bearers before actor. Subscription protocol migration replaces document epoch/revision hints with monotonic log floor/head/retentionRevision hints; hints never establish read authority. Empty/missing service metadata is unsupported, never fallback to old document API.

Independent-provider conformance and production qualification remain separate from local reference tests. A passing component test is not a deployed service claim.

## HTTP tail and durable application acknowledgment

`GET endpoint/logId/tail?after=cursor` returns `application/cbor-seq`: replay strictly after the supplied retained cursor, then live entries. Frames are deterministic CBOR maps encoded/validated through the pinned Snug codec. `ready` supplies log metadata, a catch-up highWater and the finite physical lease deadline. `entry` supplies cursor, UUIDv7 operationId and opaque byte-string data. `terminal` communicates trim, forbidden access, reauthentication, retry/backoff or lease completion. Payload and frame buffers are bounded; the stream is a sequence, not one unbounded CBOR array.

The SDK reconnects from the last **application-acknowledged committed cursor**, not the original subscription cursor or last decoded item. Commit application state and its cursor durably together, then call the delivered item's `ack()`. Receiving or yielding an item is not an acknowledgment. An unacknowledged item can repeat after interruption. Acknowledgment grants no trim/checkpoint authority.

An explicit cursor below retained history fails with HTTP410 `log_trimmed` before response commitment, or a typed terminal frame once streaming. Never silently skip to the current floor. The app keeps its local state/outbox and chooses a recovery path. Provider archiving is transparent; apps do not control hot/cold placement.

Each physical response has finite authority, byte/work budgets and bounded retries. Workers use a private hibernating account-actor WebSocket behind the public HTTP stream; clients do not implement that private protocol. Current Native/grant checks, cleanup after disconnect/expiry/purge, actual hibernation and hosted cost qualification remain release requirements.
