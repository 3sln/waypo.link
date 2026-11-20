# Independent ordered-log storage extension

Contract accepted on 11 November 2026 and implemented in the reviewed integration candidate. Exact local Worker browser evidence and remaining qualification are recorded in the [current map](https://github.com/3sln/waypo/blob/def58bd/docs/implementation/plan.md); independent conformance and production release remain separate gates. This replaces prerelease provider CRDT sync, not independent blobs. No public compatibility/production claim. Limits below are provisional implementation profile.

Discovery is `waypo_logs:{version:'1',endpoint:'https://id.example/api/services/logs',scopes:['logs:read','logs:append','logs:trim']}`. Endpoint obeys existing issuer-origin/HTTPS validation. Clients normalize as features.logs. OAuth scopes are separate; old sync grants grant none, and append does not grant trim. Identity derives issuer/account/client from current verified OAuth; requests cannot choose account/client/storage route. Logs and receipts are private to that namespace. Independent waypo_blobs remains unchanged. Payload bytes are opaque; no CRDT parsing, app checkpoint, clear, delete-log or reset API.

The metadata may also include a closed `limits` object. When present, all five fields are required: `entryBytes` (1..4194304), `pageEntries` (1..256), `pageBytes` (at least `entryBytes`, at most 4194304), `retryWindowMs` (1..604800000) and `futureSkewMs` (0..300000), all safe integers. Defaults when omitted are 65536, 64, 262144, 86400000 and 60000 respectively. The current reference HTTP profile advertises its actual 64 KiB/64-entry/256 KiB limits; a larger codec ceiling alone does not enlarge those endpoints. Independent implementations must bound their actual endpoints consistently with their declaration.

Log IDs match `[A-Za-z0-9_-]{1,64}`. Cursor tokens are opaque base64url, 1..512 characters, cryptographically bound to issuer/account/client/log/incarnation/position. Position0 is an origin sentinel with committed=false; it never grants destructive authority. Positive cursors identify committed entries. Clients never decode/arithmetic/construct cursors. Internal positions and wire revisions are unsigned 64-bit canonical decimal strings, maximum 18446744073709551615, never unsafe JS Numbers. Refuse overflow; do not reset sequence/incarnation.

## Wire DTO

Responses are no-store. Finite operations return bounded JSON; append accepts raw bytes and a successful tail returns the CBOR sequence specified below. Errors have `{error}` and explicitly documented authorized metadata; no foreign namespace leakage.

| Request | Result |
| --- | --- |
| POST endpoint `{logId}` | logs:append; create-only 201 metadata,409 log_exists. No implicit append-create. |
| GET endpoint `?after=logId&limit=N` | logs:read; lexical exclusive page `{logs:[metadata],nextCursor:null-or-logId}`. Cursor remains app-local. |
| GET endpoint/logId | logs:read; metadata. |
| POST endpoint/logId/entries | logs:append; raw application/octet-stream; required Idempotency-Key UUIDv7; optional Waypo-Expected-Head cursor.201 new / 200 replay receipt. |
| GET endpoint/logId/entries `?after=cursor&through=cursor&limit=N` | logs:read; exclusive after, inclusive through; bounded JSON range page. |
| GET endpoint/logId/tail `?after=cursor` | logs:read; finite physical HTTP stream of CBOR records, replay then live. Portable clients supply an explicit resume cursor. |
| POST endpoint/logId/trim-before `{cursor,retentionRevision}` | logs:trim; strict exclusive boundary with revision CAS;200metadata or409 retention_conflict with authorized current metadata. |

Metadata is `{logId,origin,head,floor,retentionRevision}`. Empty log: head=origin, floor=null, retentionRevision='0'. Nonempty log: head is latest committed cursor and floor first retained committed cursor. Trim cannot remove its boundary, therefore cannot empty a nonempty log. Create returns the same metadata shape. List response limit initially64 with bounded total metadata bytes.

Receipt is `{operationId,cursor,retained,head,retentionRevision}`. operationId exactly equals canonical supplied UUIDv7. Replaying a trimmed operation returns its original cursor, retained=false, never reappends. See log-semantics.md for expiry, ordering and intent hashing.

Read page is `{entries:[{cursor,operationId,data}],origin,floor,head,retentionRevision,highWater,nextCursor,hasMore}`. data is canonical unpadded base64url of opaque payload. Count and decoded bytes both bounded: initial maximum 64 entries / 256 KiB decoded total; each entry max 64 KiB. Overall encoded JSON envelope also gets an explicit finite HTTP bound. nextCursor is the last returned cursor when hasMore, otherwise null. head reports observed head; highWater is immutable inclusive snapshot bound. If through omitted, capture current head once and return it as highWater; carry `through=highWater` across pages. through may be origin to represent a stable empty snapshot even if later appends arrive. No page includes positions beyond highWater. Omitted after deliberately starts at retained floor; supplying origin requests history from creation and detects trimming. Cursor existence/binding/ordering are validated before reading; future/uncommitted/foreign tokens refused.

An explicit after/resume cursor must still belong to retained history. After a trim, any supplied position below floor returns 410 log_trimmed, including the immediate predecessor. The origin sentinel is accepted for an empty log or an untrimmed log whose floor is position 1. Omitting after explicitly starts at the current retained floor; clients must not silently omit a rejected resume cursor. If trim erases any requested snapshot range,410 log_trimmed returns `{error,origin,floor,head,retentionRevision,highWater}`; never silently skip it. If after>=through, return bounded empty page/hasMore false, after rejecting future/foreign cursors; origin through denotes empty snapshot. Reader still checks current authority and lifecycle. Any race after archive I/O must produce a coherent retained range or explicit trimmed/retry response.

Trim boundary must be positive committed cursor, never origin, synthetic head + 1 or absent boundary. Missing revision/boundary invalid. Matching revision at/below current floor may be no-op; stale revision409 even if the prior action probably succeeded. Successful advancing trim increments retentionRevision once and atomically enqueues floor/head notification. Lost response requires metadata reconciliation; SDK never silently changes boundary or trims automatically.

## Provider transport requirements

Bound bodies before parse and authorize before reading append bytes; preserve DPoP/origin validation, final authority and terminal lifecycle checks. Node and account actor HTTP implement identical contract. Signed actor leases include only new exact scopes and namespace; old scope aliases forbidden. Strip native bearers before actor. Subscription protocol migration replaces document epoch/revision hints with monotonic log floor/head/retentionRevision hints; hints never establish read authority. Empty/missing service metadata is unsupported, never fallback to old document API.

Independent implementation evidence is pending. Portable proof is not HTTP, cursor authenticity, durable adapter, archive object or runtime release evidence.

## Public tail request and response

The reviewed implementation mounts `GET <endpoint>/<logId>/tail?after=<cursor>` under the same current `logs:read` authority and namespace as finite reads. Clients should send `Accept: application/cbor-seq` using authenticated fetch/HTTP; browser EventSource is not this wire format. There is no `Last-Event-ID` header, SSE `data:` envelope, public WebSocket requirement, public transport-credit message or ACK endpoint. `through`, `limit` and duplicate/unknown query parameters are not tail parameters. Portable clients supply `after` explicitly; use the log's returned origin only when deliberately requesting history from creation. The SDK requires an explicit cursor. The Node shell's permissive omitted-cursor path is not a portable resume mechanism.

Before opening a body, validate current authority, namespace, cursor binding, retained range and connection/work capacity. Initial failures use the ordinary bounded JSON HTTP error contract, not a successful empty stream: invalid/future/foreign cursor 400, missing log 404, unavailable authentication 401, forbidden 403, retained-history loss 410 `log_trimmed`, or temporary 429/503 with a declared retry hint where applicable. Authorized retention errors carry current metadata as described above. HTTP 200 does not make a first-party browser cookie into app authority.

A successful response has `Content-Type: application/cbor-seq`, `Cache-Control: no-store` and no requirement for a complete-body Content-Length. It is a sequence of complete CBOR map items as defined by [RFC 8742](https://www.rfc-editor.org/rfc/rfc8742.html), not an enclosing array. HTTP chunks may split one item or contain several items; a decoder must retain bounded partial-item bytes and parse item boundaries. A connection may remain idle without heartbeat items. Logical subscription lifetime may be indefinite, but every physical connection has a finite authority lease and bounded buffers.

### Encoding and closed record schema

The v1 profile uses [RFC 8949 core deterministic encoding](https://www.rfc-editor.org/rfc/rfc8949.html#section-4.2.1): shortest representations, definite lengths and deterministic encoded-key ordering. Record keys are text. Only the shown field types/keys are part of the profile; duplicate/unknown keys, undefined values, trailing invalid items and malformed/non-profile encodings are errors, not ignorable extensions. Payload bytes inside `data` are opaque and are not interpreted as CBOR by Waypo. Another implementation can use any conforming codec; vendored Snug is the reference choice, not a dependency required of other providers.

This CDDL mirrors the public reference schema. The semantic constraints following it also apply; string length alone is not cursor or UUID validation.

```cddl
cursor = tstr .size (1..512)
revision = tstr .size (1..20)
ready = {
  type: "ready", logId: tstr .size (1..64), origin: cursor,
  floor: cursor / null, head: cursor, retentionRevision: revision,
  highWater: cursor, leaseExpiresAt: 0..9007199254740991
}
entry = {
  type: "entry", cursor: cursor, operationId: tstr .size 36,
  data: bstr .size (0..4194304)
}
terminal = {
  type: "terminal",
  error: "log_trimmed" / "forbidden" / "reauthenticate" / "retry" / "lease_ended",
  ? floor: cursor / null, ? head: cursor, ? retentionRevision: revision,
  ? retryAfterMs: 1..2678400000
}
frame = ready / entry / terminal
```

- `logId` matches `[A-Za-z0-9_-]{1,64}`. Cursor text matches `[A-Za-z0-9_-]{1,512}` and is provider-authenticated/namespace-bound; clients never decode, construct or order it. `operationId` is the canonical lowercase UUIDv7 supplied for the append, not an arbitrary 36-character string.
- `retentionRevision` is a canonical nonnegative decimal string, at most 18446744073709551615, with no leading zero except `"0"`. `leaseExpiresAt` is an integer Unix-millisecond deadline, never an unsafe JavaScript number or seconds. The reference host grants at most five minutes, possibly shorter than current app authority. Its SDK rejects elapsed deadlines or a deadline more than six minutes ahead of its local clock; arbitrary long provider leases are not compatible with that profile.
- `ready` occurs once before entries. Its metadata belongs to this log. Empty state has `floor:null` and `head===origin` and `highWater===origin`; a nonempty floor is a committed cursor different from origin, and head is not origin. `highWater` describes the opening read's catch-up boundary, not the stream's final upper limit or an application acknowledgement. Live entries may later extend beyond it. Do not resume from `ready.head` or `ready.highWater` merely because the record was received.
- `entry.data` is a CBOR byte string, including an allowed zero-length payload. Effective size is also bounded by the advertised `limits.entryBytes` (default 65536); the 4 MiB CDDL ceiling is codec capacity, not a promise that every host accepts 4 MiB appends. Reference maximum encoded item size is `max(131072, entryBytes+4096)`, with depth 8, 32 map entries and 64 items. Refuse oversized declared lengths before allocating/waiting for their entire body.
- `terminal` is the error/end record; there is no separate `{type:"error"}` record. For `error:"retry"`, `retryAfterMs` is required, integer and positive. It is absent for every other terminal error. Optional floor/head/revision values must satisfy the same field constraints and belong to an authorized log; revoked/foreign callers do not receive private metadata.

These are illustrative CBOR diagnostic values, not literal JSON bytes or minted valid server cursors:

```cbor-diag
{"type":"entry", "cursor":"opaque_committed_cursor",
 "operationId":"018bcfe5-6800-7000-8000-000000000001", "data":h'0001ff'}
{"type":"terminal", "error":"retry", "retryAfterMs":5000}
```

### Replay, processing and ACK

Register live wakeups before capturing the initial replay boundary, or use an equivalent durable mechanism that leaves no replay/live gap. Emit retained committed entries strictly after the supplied `after`, in log order, then continue with later commits. Storage placement, physical connection boundaries, archive publication and wakes cannot skip a retained entry. Transport delivery may repeat entries after failure; it is not exactly-once application processing.

The consumer atomically commits its reduced app state **and that entry's cursor**, then acknowledges locally. ACK is an app/SDK processing action; it does not POST a provider checkpoint or prove durable processing to the server. The reference iterator yields `{entry:{cursor,operationId,bytes},ack}` and refuses the next item if the selected item was not acknowledged. It stores no durable application cursor itself. On process restart, reconstruct the logical tail with the app's persisted processed cursor.

On physical reconnect use the last processed/acknowledged cursor, never the initial subscription cursor, last decoded/uncommitted item, transport delivery cursor or byte credit. A crash after durable app commit but before local ACK may redeliver; the app must reconcile its atomic stored state/cursor rather than repeat non-idempotent external side effects blindly. A partial CBOR item never advances the cursor. Complete preceding items may be committed before a later truncated item; malformed schema is a protocol error. Neither EOF nor a network failure means history is complete: reconnect from the safe cursor under current authority.

Supplied stale resume cursors follow the same strict retention rule as finite reads. A cursor below current floor is 410 `log_trimmed`, including the immediate predecessor; origin is accepted only for an empty or still-untrimmed log. An active stream whose next range was trimmed must terminate explicitly with `log_trimmed` or an equivalent failed reconnect, not silently jump to a new floor. Omitting a rejected cursor or fetching a latest head is an explicit app recovery decision, never automatic SDK data loss.

### Terminal and reconnect decisions

| Terminal `error` | Client decision |
| --- | --- |
| `log_trimmed` | Stop the logical tail with history unavailable; preserve local state/outbox and expose authorized current floor/head/revision when supplied. The app chooses snapshot/recovery; do not silently skip. |
| `forbidden` | Stop service effects. Do not loop login/refresh or delete locally cached identity solely because this service grant is denied. |
| `reauthenticate` | Obtain current app authority through the app's configured renewal flow, then open after the safe cursor. The reference SDK permits one renewal per failed chain, preventing immediate ready/renew loops. |
| `retry` | Wait at least `retryAfterMs`, then reopen with current authority and the safe cursor. Capacity/maintenance pressure is not logout. |
| `lease_ended` | Close this physical body and reopen as appropriate from the safe cursor; expiry does not assert app grant revocation. |

After a terminal record no further entries belong to that physical stream. A terminal failure can arrive before `ready` when no entries were emitted; the reference client forbids `lease_ended` before ready. A clean EOF or uncertain transport close may omit a terminal record; retain the safe cursor and use bounded reconnect backoff. Initial HTTP 401 may use the same bounded renewal path; 403 and 410 are not transient retries. For temporary HTTP responses, honor the longest valid `Retry-After`/maintained `X-Retry-After` and `retryAfterMs` hint. Current SDK reconnect pacing and finite timer chunks are implementation safeguards, not permission to probe before a provider floor after focus/online events.

### Deployment seam and qualification

Node and other providers can implement the same public byte stream with their own durable wake/authority mechanisms. The reviewed Worker profile keeps the public HTTP body in the front Worker and uses a private hibernating WebSocket/event engine at the account actor. Its private byte credits limit buffering; they are never the app's processed ACK. That internal layout and signed work leases are not public protocol fields. See the [Worker bridge implementation note](worker-log-tail-bridge.md).

Local engine/HTTP/SDK and actual multi-app/provider workerd browser evidence establish the stated local behavior, including cold replay and restart. They do not establish independent-provider conformance, deployed idle hibernation duration, Cloudflare charges or production readiness. Public hibernation/billing verification remains a separate measured gate. Production remains disabled.
