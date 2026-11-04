# Synchronized document semantics and codec boundaries

Status: engineering contract proposal and source audit, 2026-11-03. Production remains disabled. The currently selected reference implementation is Yjs 13.6.33; this document does not claim that a second CRDT, a universal operation protocol, or an automatic cross-engine migration exists. The bounded SDK codec extraction is coordinated separately. Examples marked proposed describe a compatibility direction, not an additional implemented SDK.

## What engine independence means

Applications should express edits through Waypo-owned map, list and text operations and receive detached ordinary values. They should not need Yjs classes, update decoders, state vectors, replica clocks or transaction-origin objects to use the SDK. Hiding those objects is an API boundary; it is not proof that replacing the merge algorithm preserves behavior.

Compatibility has two layers:

1. Common document guarantees define identity, accepted value types, local commit acknowledgment, isolated transaction capabilities, synchronization/replay, epoch fences, and recovery behavior.
2. A named semantic/codec profile defines the exact conflict behavior and causal representation for documents using it. Existing histories retain that profile until an explicit, fenced migration.

For a given valid history and profile, a replacement implementation must preserve the profile's observable results, including continued merges with valid old offline updates. Merely converging to some deterministic value, producing equal JSON today, or exposing the same methods is insufficient. A different profile may permit a different winner, but changing to that profile is a migration rather than a transparent implementation replacement.

The practical promise is continued support for existing profiles, or an explicit migration path that retains recovery access. It is not that every future CRDT can read every existing document. No deprecation duration or commercial support commitment is established by this design.

## Smallest practical public facade

Keep the existing top-level declaration and synchronous transaction model. `array` is the existing API spelling for a list; renaming it is unnecessary for independence. Root names and kinds are declared when opening a document. Applications use ordinary values returned from reads, not live mutable proxies.

Proposed stable application-facing subset, using current method names:

```js
const model = createSyncedDocument({
  namespace: {issuer, subject, clientId},
  documentId: 'project',
  types: {settings: 'map', tasks: 'array', title: 'text'},
  kv,
  transport,
});

await model.transaction(document => {
  document.map('settings').set('theme', 'dark');
  document.array('tasks').insert(0, [{id: 'task_a', done: false}]);
  document.text('title').insert(0, 'Project');
});

const snapshot = await model.view.peek();
// snapshot.data contains ordinary detached values.
await model.synchronize();
await model.close();
```

This example uses implemented root operations; its classification as a stable cross-profile contract is proposed. The existing `view` is an ngin query. The minimum public surface is construction, declared root access inside `transaction`, detached view subscription/read, explicit synchronization, profile metadata, scoped recovery export and close. Keep `edit(text)` as the existing `note`-text convenience, not as the generic data model. Existing `engine`, `epoch()` and raw byte exports are advanced compatibility surfaces; callers using them have a narrower portability promise than callers using ordinary values.

Do not add deep object proxies, arbitrary property assignment, automatic object graph tracking, nested shared nodes, moves, counters, sets, formatting, cursor anchors or a generic patch language merely to extract the current codec. Those features need separately versioned semantics.

## Identity, schema and ordinary values

A logical document is scoped to `(issuer, app-specific subject, canonical OAuth client ID, document ID)`. A live incarnation adds its server-issued epoch. These identifiers are not interchangeable: a Yjs client ID is an ephemeral causal replica identifier, not a user, device, OAuth client or document ID. The namespace must come from verified identity/session bindings, never an unverified account selector. Moving data between issuers, subjects or clients is an explicit export/import operation with authority checks.

Each declared root has an immutable kind within the supported incarnation. Adding a new declared root may be an additive schema change when the profile allows it; reusing a root name for another kind is incompatible and must fail before publication. The current SDK persists local root declarations, but the current service does not enforce an authoritative server-wide root schema on each update. Concurrent clients declaring different kinds are therefore not a solved interoperable feature; an app must distribute consistent declarations. App schema version and merge profile version are separate concepts.

The proposed common value domain is finite JSON: null, booleans, finite numbers, strings, dense arrays and plain own-property string-keyed objects composed from those values. Numbers have JavaScript binary64 semantics, not arbitrary precision; precision beyond safe integers must use app-owned string encodings. Keys are case-sensitive strings. No Unicode normalization, locale-aware key comparison, map enumeration order or object property order is part of logical equality. No functions, symbols, undefined values, cycles, accessors, class instances, binary buffers or shared-type instances belong to this portable domain.

Important current limitation: the SDK currently converts inserted map/list values with `JSON.stringify` followed by `JSON.parse`. That can coerce dates and nonfinite numbers, drop object fields or convert array holes/undefined to null. It does not yet implement the strict rejection domain above. Existing compatibility behavior must be documented or migrated deliberately; a codec extraction must not quietly change it. Reads are detached copies, so mutating a returned object does not emit a synchronized edit.

Objects and arrays stored as map values or list elements are atomic JSON values. For example, concurrently setting `settings.profile` to `{name:'A', colour:'red'}` and `{name:'B', colour:'blue'}` does not merge the two objects' fields. Exactly one whole assignment is visible according to that profile. Applications needing independently mergeable fields should use separate map keys or roots. An app's `{id:'task_a'}` field is ordinary application data and supplies no automatic uniqueness, deduplication or list-item identity.

## Map semantics

The minimal operations are `get(key)`, `set(key,value)`, `delete(key)` and detached `toJSON()`. Missing keys return undefined; storing null is distinct from deleting a key. The portable caller must use valid string keys and ordinary values. Current key limits are reference limits, not a universal protocol limit.

Sequential operations in one transaction observe preceding operations in that same callback. A successful nonconcurrent set replaces the entire value. Independent writes to different keys survive exchange of all valid updates unless a causally later operation removes or replaces those keys.

Concurrent writes to the same key and concurrent delete/write pairs are resolved by the active profile. The common API does not promise wall-clock last-writer-wins, arrival-order wins, delete-wins, add-wins, a visible multivalue register or retention of a losing value. The current Yjs profile has its own causal/item ordering. Applications must not infer an actionable business decision from which concurrent value won. Payments, inventory, uniqueness, authorization and compare-and-swap require separate authoritative application operations.

Exact profile compatibility requires preserving the actual winner for the same retained causal history. It is insufficient for an alternative engine to choose a different deterministic winner that happens to be permitted by this common description. A future portable arbitration algebra would need stable operation identities, canonical tie ordering and a versioned operation envelope; none is implemented by this extraction.

## List semantics

The current `array(name)` supports `insert(index, values)`, `delete(index,length)`, `get(index)`, detached `toArray()` and `length`. Indexes refer to the callback's current local visible list, not a permanent shared position. In the portable valid-input domain, insert positions are integers from zero through length; deletion ranges contain existing elements. Invalid input behavior delegated to a codec is not a useful compatibility guarantee and should become explicit validation in a separately reviewed change.

A deletion identifies the existing elements observed at that range when the edit is generated; it is not a rule to delete whatever future merged elements occupy those numeric offsets. An unseen concurrent insertion can survive deletion of neighboring or overlapping observed content according to the profile. Concurrent same-gap insertions retain accepted values, but their relative order, grouping and interaction with neighboring edits are profile-specific. Do not promise a generic append timestamp order or universal noninterleaving rule.

List elements have internal causal identities. These identities must remain meaningful for old offline operations within an epoch, but the minimal facade does not expose durable element handles. Deleting and reinserting the same JSON creates a new causal element; it is not an identity-preserving move. Stable application references should use app-owned IDs and map records, with the app explicitly handling duplicate IDs caused by concurrent list insertions. Ordering tasks as an ID list and storing task records in a map is a modeling convention, not a built-in uniqueness constraint.

## Text semantics

The minimal text API is plain-string `insert(index,string)`, `delete(index,length)`, `toString()` and `length`. It does not expose rich-text attributes, embedded objects, XML, relative cursor positions or undo history.

Current positions and lengths use UTF-16 code units, matching JavaScript string offsets; they are not bytes, Unicode scalar indexes or grapheme clusters. For example, `'A😀B'.length` is four. Applications must choose boundaries that do not split surrogate pairs and implement grapheme-aware editing above this API when required. There is no automatic Unicode normalization. The installed Yjs `ContentString.splice` replaces split surrogate halves with U+FFFD; this is a current-profile edge behavior, not a portable way to edit a character.

Concurrent text insert/delete interactions follow the same observed-element distinction as lists. The exact order for insertions at a shared gap, and how replacement edits interact with nearby edits, remains profile-specific. `edit(text)` currently computes a common UTF-16 prefix/suffix and submits a delete/insert pair; it is not an atomic globally last-writer-wins replacement. Its split-boundary and concurrent replacement behavior require compatibility fixtures if that convenience is retained unchanged.

## Transactions, durability and observation

A transaction callback is synchronous and scoped. All mutation handles expire when it returns or throws. An async callback is rejected; an app must perform I/O before opening the transaction and then re-evaluate local state inside it. Returning or capturing a handle does not extend write authority. Callback reads see earlier callback edits. A thrown callback or failed local persistence must not turn partial intent into a publishable outbox entry.

The promise resolves after the snapshot/outbox operation has committed through the injected durable local store. That acknowledgment means locally committed, not accepted by a server or observed by every replica. UI can display provisional `saving` state before commit; rejection can roll back that provisional view and expose recovery data. The current SDK implements rollback by reconstructing its private state, not by assuming an underlying Yjs transaction is a database rollback facility.

Transactions group local edits but do not provide global serializability, cross-document atomicity or invariant preservation during merge. One logical transaction may be represented by different update batches; observers may coalesce refreshes. Promise resolution and view emissions are not a durable audit log. Event count, callback ordering across independent documents, polling delay and outbox item count are not application-level operation identities.

The browser adapter uses IndexedDB transaction completion and cross-context Web Locks; a short local lock must not be held while awaiting provider requests. Store notifications can refresh other tabs without contacting the provider. This is browser-local functional durability, subject to storage availability, browser eviction, user deletion and device loss; it is not a power-loss or permanent-retention guarantee.

## Offline operations, replay and synchronization

Offline edits remain bound to their original namespace, epoch, root declarations and profile. A successful local commit retains causal updates and replay identities until acknowledged publication. A process crash or lost response must retry the identical in-flight batch, rather than inventing a fresh operation that could duplicate a list insertion. Batching and outbox coalescing may change the number of stored entries without changing their causal intent.

The current Yjs update profile supports duplicate and reordered delivery once all causal dependencies arrive. This content idempotence is distinct from indefinite exactly-once HTTP receipt caching. The service has a bounded request receipt cache; retry behavior outside it relies on the codec's idempotent content semantics. No exactly-once external side effects are authorized by a sync update.

`pending` counts implementation outbox/pending entries, not user edits or characters. `synced` means the SDK completed its present exchange and has no known unacknowledged local batch; it does not mean every replica has seen the state or no concurrent remote edit exists. Quota/backoff/connectivity errors preserve committed local intent. Authorization failure blocks further network effects for that instance; changing accounts requires a new verified binding and orderly close, not altering the namespace in place. A revocation does not automatically erase an application's local user data; local privacy/deletion remains an explicit product policy.

Current runtime states include local, saving, synced, offline, full, recovery, disconnected and limited. A host-owned poller/scheduler handles retry timing and must honor persisted Retry-After constraints. Construction and local edit must not silently open provider transport. There is no promise of indefinite offline admission beyond bounded document/outbox/storage capacity.

## Profiles and version negotiation

Keep these axes distinct:

| Axis | Current/selected identifier | Meaning |
| --- | --- | --- |
| SDK API | package version, currently prerelease | Method/value/async compatibility |
| Codec adapter | `yjs-v1` | Maintained implementation of codec operations |
| Local persistence | `waypo-yjs-local-v1` | Local snapshot/outbox/root/profile record interpretation |
| Wire codec | `yjs-update-v1` | Server-supported structural binary update representation |
| Semantic behavior | `waypo-yjs-semantics-v1`, initially Yjs 13.6.33 | Exact causal conflict/history behavior; not interchangeable with arbitrary CRDT rules |
| App schema | Application-owned version and root declarations | App field/value meanings |
| Epoch | Server-issued incarnation identifier | Fences incompatible/recreated causal histories |

The coordinated extraction exposes a frozen `model.codecProfile` object with `adapterId`, `semanticProfile`, `localProfile` and `wireProfile` matching the table. These identifiers are not library package versions. An implementation/library upgrade may keep a semantic profile only when the profile's documented observable behavior and exact conflict conformance vectors remain compatible; the same binary wire format alone is insufficient. Changing semantic behavior requires a new semantic profile and an explicit compatibility/migration decision. The current runtime accepts only the registered Yjs adapter object, so this metadata is descriptive rather than multi-codec negotiation.

Missing profile markers may be interpreted as legacy Yjs only on existing local records known to originate from that SDK. An explicit unknown/mismatched profile must fail closed, preserve raw local state for export and avoid transport before decode. Do not try several decoders until one appears to work. The current prerelease local change is directional: the new SDK reads unmarked legacy rows, but the first marked write adds `localProfile`, which the previous SDK's exact-field whitelist rejects. Old and new bundles therefore do not have bidirectional local-reader compatibility. Before deploying this prerelease transition, the host must coordinate active tabs and service-worker/bundle updates, close old instances, and retain recovery export access. No production release exists; this explicit transition is not a precedent for silently changing a stable local format. A future stable-format upgrade needs reader/version gating and a deliberate rollout/migration policy.

Metadata must travel with durable state/recovery exports; a process-default codec is not sufficient to identify old stored bytes.

The current provider advertises `yjs-update-v1`, applies Yjs updates, exports Yjs snapshots and uses a Yjs-specific compactor. A client-side codec seam does not negotiate new server codecs. A future provider needs explicit supported wire/semantic profiles, per-document authoritative profile metadata and compatible authorization/quota validation before accepting another codec. Silently changing discovery strings or decoding an existing epoch under another codec is forbidden by this design.

## Migration and recovery

An adapter replacement can keep the epoch only when it reads the existing causal state, preserves internal identities/tombstones required by old offline updates, accepts the old supported update protocol and preserves that profile's exact observable merge results. It needs a real compatibility proof/conformance suite; a fixture-only fake second codec is not evidence.

An incompatible codec/semantic migration instead requires an explicit new epoch and transition record naming old/new profiles and app schema. Coordinate migration against in-flight writers with an authoritative revision/epoch fence. Publish the replacement snapshot and profile atomically; reject old-epoch writes afterward. Retain a bounded recoverable old branch/export according to user-visible policy. Announce how old clients behave, and either keep the old adapter available for read/recovery or provide an explicit migration client. No live bytes may be rebound merely because the document ID is unchanged.

A materialized JSON export can preserve visible root values but loses causal element identities, tombstones, hidden conflict history, formatting unsupported by the facade and queued edit relationships. Importing it is a deliberate copy/rewrite into a new epoch. It cannot reproduce later merge results with old offline updates. Outbox-empty on one client does not prove every device is online or has no pending changes. General automatic offline intent rebasing across profiles is not implemented and may be impossible without application decisions.

The existing compaction codec already distinguishes same-epoch causal GC from a fresh document rewrite with declared roots. Preserve that distinction. `exportLocal()` remains raw Yjs update bytes for existing callers; a new descriptive recovery envelope can identify profiles but is not a codec-independent JSON interchange format. The additive `exportLocalDescribed()` returns `format:waypo-codec-backup-v1`, scoped namespace/document ID/epoch, the four codec profile identifiers, and raw `Uint8Array` update bytes. `exportStoredState()` retains its existing exact `waypo-local-recovery-v1` envelope with raw stored state, including corrupt/unknown bytes where possible; localProfile is acquired only through an actual subsequent write, not a read-time upgrade. Do not contact a provider merely to export rejected local state.

## Conformance matrix and evidence boundaries

These are required acceptance scenarios for a claimed profile-compatible replacement, not a statement that all are already implemented tests. Existing SDK tests cover many lifecycle cases. The coordinated codec tests add initial fixed binary histories and exact map/sequence outcomes; these are useful regression anchors, not a complete replacement proof. Broader historical conflict vectors and strict-value rejection remain work to add.

| Scenario | Strong common guarantee | Profile-specific outcome / verification |
| --- | --- | --- |
| Concurrent writes to different map keys | Both independent effects survive after all valid updates arrive | Compare full detached results under delivery permutations |
| Concurrent writes to the same key | All replicas converge for one profile/history; no arrival-clock promise | Preserve exact reference winner; a different deterministic winner fails same-profile compatibility |
| Delete versus concurrent map write | Replica convergence; null and absence remain distinct | Record exact delete/write result from fixed causal histories |
| Atomic object replacement | Whole JSON values, no hidden field-wise shared merge | Competing object fields must not be combined into an invented hybrid |
| Concurrent inserts in the same list/text gap | Accepted updates converge without duplicate replay effects | Exact ordering/grouping must match reference profile, not generic arbitrary tie order |
| Delete range versus concurrent insertion | Delete targets observed causal elements, not later numeric occupants | Exercise edge/interior gaps and ordering with deleted anchors |
| UTF-16 indexing | JS code-unit lengths and offsets for valid boundaries | Emoji, combining marks, invalid split handling and edit convenience vectors |
| Callback throw / async escape / failed local commit | No failed intent becomes publishable; handles expire | Verify provisional view rollback, durable bytes and subsequent outbound batches |
| Duplicate / reordered updates / lost acknowledgment | Retain stable retry batch; eventual convergence under complete valid delivery | Preserve original request IDs and causal content; do not claim unbounded receipt history |
| Same-origin tab concurrency | No lost committed local branch; network waits do not hold local lock | Real IndexedDB/Web Locks reload and tab notification evidence |
| Stale epoch / deleted and recreated ID | Old branch is retained for recovery and not rebound | Original epoch's pending bytes never mutate the replacement |
| Unknown/new profile with queued edits | Reject before decode/network, preserve recoverable old state | Explicit migration or original adapter; no empty-state fallback |
| Same-epoch checkpoint/GC | Offline valid operations retain their causal meaning | Deleted-parent/anchor and old-update cases must still converge |
| New-epoch rewrite | App-visible migration/recovery fence | JSON equality before migration is insufficient proof of later semantic equivalence |

Acceptance also needs resource/hostile-input bounds and user-visible failure behavior, not just happy-path convergence. Current reference limits include 64 KiB updates, 128 KiB encoded document state, 64 local outbox entries totaling at most 1 MiB, 4096 decoded structures and 262144 cumulative structure lengths. Counts/bytes are implementation admission policies, not API promises of unlimited data or measured hostile-input CPU isolation. A new codec needs its own declared limits and cannot evade account quotas or authorization by changing its encoding.

## Read-only audit findings and next scope

`packages/sdk/document.mjs` initially couples orchestration to Yjs construction, root registration, capture/apply/merge updates, structural limit inspection, snapshot export and recovery rollback. `packages/sdk/sync.mjs` is a thin export; its “generic” claim describes app-shaped root operations, not a generic server wire protocol. `packages/sdk/indexeddb.mjs` is principally engine-neutral but its default database name and existing raw local rows are compatibility commitments.

The current facade does not expose Yjs objects, but advanced raw-byte exports, transport bytes, decoded structural limits and local records still expose its profile. Existing ngin `engine/view` exposure is a separate framework coupling. The extraction should move codec operations behind a frozen validated descriptor while preserving local keys, pending batches, byte export compatibility, scope expiration and local commit ordering. It should not manufacture a second adapter, relax stored-state validation or change conflict semantics during the refactor.

`packages/services/index.mjs`, service discovery, catalog exports and `packages/services/compaction-codec.mjs` remain explicitly Yjs-specific server boundaries. Server multi-codec admission, a complete engine-neutral arbitration algebra, strict JSON input validation, deep proxies, richer nested types and general cross-profile migration are subsequent scoped tasks. They are not implied by moving an import into a codec file.

## Primary references

[Yjs document updates](https://docs.yjs.dev/api/document-updates) describes idempotent, commutative update application; it does not make arbitrary CRDTs interchangeable. [Y.Text](https://docs.yjs.dev/api/shared-types/y.text) defines UTF-16 indexing. [Yjs shared-type caveats](https://docs.yjs.dev/getting-started/working-with-shared-types) explains shared-type identity and JSON mutation hazards; Waypo's detached ordinary-value facade intentionally avoids exposing those live objects. Exact current edge behavior was also checked against the installed Yjs 13.6.33 `Item.js` and `ContentString.js` source; these internal algorithms remain profile implementation details, not a new public operation format.
