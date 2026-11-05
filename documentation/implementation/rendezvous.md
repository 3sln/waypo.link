# Participants and rooms reference contract

> **Status:** Development reference contract. The hosted package pin is unchanged and this page does not claim deployed support. The protocol is an optional profile of the [signaling OIDC extension](../design/signaling-extension.md).

## Status and scope

The current branch contains participant/presence/room engine, HTTP adapter,
discovery extension, direct SDK, reusable device authorization helper and a prepared
backendless browser demonstration. This describes source behavior, not a release
or completion certificate. Native durable-adapter and maintenance integration,
full security gates and actual browser execution evidence remain separate checks.
Do not infer a passing network deployment from a prepared script or engine tests.
Production release remains subject to the [release gates](../release-gates.md).

New rooms are SAME-PROVIDER only. Existing legacy two-party signaling and its
federation are unchanged; they do not implement new room federation. Cross-provider
room membership, guest admission, provider-owned picker, TURN/media relay, public
NAT traversal and actual TV compatibility remain deferred.

## Minimal-enabler boundary

An app without its own backend or an optional storage grant can use authenticated
public-client OAuth and rendezvous directly. Waypo authenticates provenance, app/account
namespace, participant instance, finite room membership and bounded setup traffic.
Apps own file transfer, clipboard consent, casting protocols, agent permissions,
trusted pairing, command authorization and UI. A role label or metadata declaration
never grants app authority. Existing optional sync may persist app configuration;
rendezvous neither requires it nor creates another general database product.

Canonical sources: packages/services/rendezvous.mjs, rendezvous-http.mjs,
discovery.mjs; packages/sdk/rendezvous.mjs; samples/device-flow.mjs;
e2e/sample/rendezvous.mjs; samples/rendezvous-browser.txt.

## Identity, proof and provenance

Server resolves current Bearer app authority and scopes signaling:read/write.
It derives issuer/user/client binding and retained grant lineage; input JSON cannot
select those. Participant ID identifies one registered instance, not a physical
device, passkey, provider browser session or global identity. ID alone is no proof.
Every operation except register/discover requires its participantId plus secret,
AND valid current app authority for that account/client. HTTP carries secret only
in X-Waypo-Participant, never JSON, a URL or an invitation. Provider cookies do not
substitute for an app Bearer credential. The reference uses hashed participant
secrets, not a claimed hardware/proof-of-possession credential.

Stored original grant authority must remain live. A new app grant plus an old
secret cannot revive a participant whose original lineage was revoked; register
again. revoke permits cleanup with current app authority, matching account/client
and exact secret even if the participant's old lineage has died. That exception
authorizes cleanup only, not reading messages, renewal or room access.

Read responses expose participant IDs, labels, roles, metadata and availability;
no native user IDs. sameAccount is a server-computed viewer-relative indication,
not a caller-supplied assertion or portable cross-provider identity. Metadata and
roles remain untrusted app statements. A participant secret isolates its mailbox
from other same-account/app instances that merely possess their own credentials.
Same-origin script/XSS can still access credentials the app gives that execution
context; this is not isolation against a compromised app.

## HTTP / discovery

When explicitly enabled, public capability discovery includes:
 waypo_signaling.rendezvous = {version:'1',endpoint:<same-provider endpoint>}
Discovery reveals provider capabilities, never participant presence or account
existence. New methods POST JSON to /api/services/rendezvous/<command>. Responses:
 {version:'waypo-rendezvous-v1',issuer,clientId,result}
POST body is bounded64 KiB with a10s reader deadline; unknown fields are rejected
by the engine. HTTP has no query-string authority. OPTIONS advertises the explicit
Bearer/JSON/participant-proof headers. Cross-origin requests omit cookies; supplied
Origin must match an origin of that authenticated client's verified configured
redirectUris. The client metadata document's hosting origin alone is insufficient.
An Origin check supplements Bearer authorization; it is not identity by itself.

## Portable API and exact command inputs

createRendezvousEngine({store,authorize,authorizeAccepted,schedule,clock,random,
randomSecret}) uses transactional metadata and injected authority/clock/scheduling.
RendezvousAction(command,input,caller) mutates; RendezvousQuery reads.
Below P = {participantId,participantSecret}; R = {...P,roomId}. HTTP removes
participantSecret from JSON and supplies it from the separate proof header.

### Actions

```text
 register({label?,role?,metadata?,retention?})
   -> {participantId,participantSecret,expiresAt,presenceUntil}
   New unconfirmed registration expires10min, bounding orphaned secret-lost ACKs.
   Retention defaults to ephemeral; daemons explicitly select installation and
   retain the proof in their own credential store. Presence can expire while an
   installation credential remains valid. An expired ephemeral participant must
   register again; that does not invalidate app login or an established peer link.
   No automatic retry of registration or reconstruction of a lost secret.
 renew({...P,label?,role?,metadata?}) -> {expiresAt,presenceUntil}
   Refreshes presence2min. Default ephemeral participants expire after2min;
   explicit retention:installation retains the participant credential for30days.
   Retention is immutable after registration; it grants no extra app authority.
   Existing label/role/metadata survive omitted fields. Original lineage must live.
 revoke(P) -> {revoked:true}
   Removes participant and owned rooms / other memberships with bounded stock.
 createRoom(P) -> {roomId,expiresAt}
   Creator is owner and first accepted member. No app roles are interpreted.
 renewRoom(R) -> {roomId,expiresAt}
   Owner-only; resets room expiry10min from now. Does not resurrect expired room
   or extend individual message/invitation/receipt lifetimes.
 createInvitation(R) -> {roomId,invitation,expiresAt}
   Owner-only; invitation secret expires at min(room expiry, now+5min).
   Hash retained. Invitation is one claimant's finite admission capability, never
   participant proof or OAuth credential. Same claimant can retry until expiry;
   different claimant cannot claim it. Accepted/rejected claim removes invitation.
 requestJoin({...R,invitation?}) -> {requested,member}
   Caller explicitly asks to join from its participant. Same account/app may use
   a discovered room without invitation; another account needs valid invitation.
   Still same provider and same canonical app. Request alone grants no membership.
 acceptJoin({...R,targetParticipantId}) -> {accepted:true}
 rejectJoin({...R,targetParticipantId}) -> {accepted:false}
   Room owner alone accepts/rejects a pending participant. Requester's explicit
   request plus owner's acceptance are the two sides of admission. No automatic
   join from QR opening or role declaration. Dead pending/members are pruned.
 removeMember({...R,targetParticipantId}) -> {removed:true}
   Owner removes an accepted or pending peer and associated queued traffic.
   Owner cannot remove itself; closeRoom instead.
 leaveRoom(R) -> {left:true}
   Nonowner leaves; removes its membership and associated messages/receipts.
 closeRoom(R) -> {closed:true}
   Owner-only. Room immediately unavailable; stale private indexes reclaimed later.
 send({...R,targetParticipantId,requestId,kind,payload}) -> {sequence,replayed}
   Target must be another accepted live member. No broadcast operation. kind is
   description or candidate; payload an object <=32 KiB. These carry setup data,
   not arbitrary app commands, media or file bytes. Server supplies from/to IDs,
   monotonically increasing room sequence, createdAt and expiresAt. Identity and
   sender fields in arbitrary payload cannot override envelope provenance.
 ack({...R,sequences}) -> {acknowledged:true}
   Deletes only messages addressed to this member; bounded<=64 sequence IDs.

```

### Queries

```text
 discover({}) -> {participants}
   Current account/exact client only, live presence only. Public participant
   descriptor includes participantId,label,role,metadata,presenceUntil,
   sameAccount:true,rooms:[{roomId,expiresAt}]. rooms lists available rooms owned
   by that participant. This is how receivers/daemons are discoverable; no generic
   incoming participant inbox or permanent all-device directory is implemented.
 listRooms(P) -> {rooms:[{roomId,expiresAt,owner}]}
   Lists live accepted memberships for this participant.
 readRoom(R) -> {roomId,owner,expiresAt,members,pending}
   Accepted member only. Pending list visible only to room owner; members/pending
   descriptors carry viewer-relative sameAccount without native user IDs.
 read(R) -> {roomId,messages}
   Accepted member sees only its addressed live messages from still-authorized
   accepted members. No arbitrary history cursor, pagination, broadcast or durable
   log contract. Host serializes room state transactionally.

```

An authenticated pending participant may requestJoin again to observe member:true;
readRoom is unavailable until acceptance. SDK/sample should not mistake that
expected pending denial for an account disconnect. Application-specific consent
screens determine what requesting/accepting means to users; server verifies the
actual authenticated admission transaction, not browser UI gestures.

## Reference limits and lifecycle

16 retained live participants/account/app. Participant initial staging10min;
valid-proof renew confirms ephemeral retention for2min or explicitly selected
installation retention for30days, with2min presence. A persistent installation
can renew after its presence expires; an expired ephemeral participant must
register afresh. Applications keep existing peer links independent of this lease. Keepalive is not proof of
human/user activity for account-retention policy. App renews only as appropriate
for an actually available receiver; suspended browsers cannot promise renewal.

8 tracked rooms/participant;8 members,8 pending requests,8 live invitations/room.
Room10min renewable by owner. Signal5min TTL independently; receipt10min TTL,
maximum128 receipts/room; invitation<=5min. At most64 queued messages/128 KiB
serialized queue including envelopes; signal payload32 KiB. label<=80 UTF-8 bytes;
role0..48 characters [A-Za-z0-9_.-]; metadata object<=1024 serialized JSON bytes.
These exact reference bounds are not a claim of unbounded fleet capacity or final
pricing. Do not promise additional metadata depth/type validation beyond source.

send requires stable requestId; dedup binds sender/requestId/target/kind/payload
hash and returns original sequence while receipt retained. Same ID with different
content conflicts. After receipt expiry or eviction, retry can deliver again.
This is bounded dedup, NOT forever exactly-once. SDK retries stay within a short
operation deadline; apps must not recycle indefinitely delayed commands as new
semantic authority. Room renewal does not retain message payloads indefinitely.

Due jobs track earliest participant/room/content expiry. One collector dispatch
processes at most8 jobs; participant cleanup yields across bounded room removals.
Accepted authority/expiry checked on use before physical collection. Jobs shared
index capped4096/installation, with finite namespace indexes; this is an initial
bounded installation design, not future fleet sharding. At capacity return busy,
not silently drop state. Maintenance/native scheduling integration must pass its
actual durable adapter gate before release claims.

## SDK transport, retry and credential custody

createRendezvousClient({issuer,subject,clientId,capability,credentials,...}) freezes
verified account context. credentials() returns that same context plus accessToken.
It rechecks context before/after request and fails on account switch. Endpoint
must exactly match discovered same-origin canonical capability (explicit validated
loopback dev exception). Requests no-store, no-referrer, redirect:error,
credentials:omit. SDK stores no credentials, starts no background polling, and
persists no participant proof itself; caller selects secure custody/lifecycle.

client.register(input) performs register then proof-bearing renew to confirm.
A temporary confirmation failure returns confirmationPending:true with the known
secret, so caller can renew; initial10min staging still bounds an orphan. An
unrecoverably lost register reply is not auto-retried. client.discover() reads
presence; client.forParticipant(record) returns bound methods matching the API.

Automatic retries apply only discover/listRooms/readRoom/read/send/ack/renew.
Encoded send and requestId remain unchanged across retries. Default3 attempts,
60s operation deadline (configured bounds maximum5 attempts/120s). Exponential
jitter respects Retry-After/structured retryAfterMs and shared backoff floor.
503 temporary errors retry;429 with retryable:false (actual stock/queue limits)
does not spin. No auto-retry of createRoom, createInvitation or membership mutation
after an uncertain response, avoiding duplicate resources/effects. Creation and
membership uncertain outcomes require caller reconciliation, not fabricated
idempotency. Structured errors expose retryability and optional delay. A retained
backoff exceeding the operation deadline returns control; no infinite hidden loop.

## Native/CLI reusable authorization

samples/device-flow.mjs retains identity-only defaults ['openid','profile','email'].
Callers explicitly request ['openid','offline_access','signaling:read',
'signaling:write'] for renewable rendezvous and provide credentialStore.save.
Provider device UI shows requested app/scopes and requires real user approval.
Helper verifies provider metadata/endpoint binding, signed ID token, UserInfo
subject and exact returned scopes before storing credential record. Refresh needs
load/save/withLock and offline_access. Under the keyed serialized lock it reloads
latest stored credential, refreshes, verifies same identity/scopes and stores the
rotation before releasing. Caller must implement an appropriate OS-protected store
and cross-process locking; helper neither supplies an OS keychain nor claims disk
atomicity. No credential prints or account-cookie reuse. samples/device-cli.mjs
still demonstrates identity only; invoking it does not advertise a daemon.

## Prepared demonstration and remaining gates

/rendezvous in Notebook/Connect sample hosts serves static app/public metadata.
Browser uses reusable device authorization, in-memory credential store/serialized
refresh and direct SDK calls to provider; no sample service BFF receives app tokens
or participant secret. It registers role/label, creates/renews receiving room,
discovers own-account receivers, requests/adopts explicit membership and uses actual
RTCPeerConnection/RTCDataChannel for app text/ping/file bytes. Sender streams file
chunks; receiver intentionally collects only a bounded1MiB sample transfer. No cloud
attachment or storage service required. Reload loses this sample's memory session.
Role names agent-host/controller/display/file-receiver grant no actual PC rights.

Prepared driver e2e/rendezvous-browser.mjs and samples/rendezvous-browser.txt specify
local Node/Worker coverage and opt-in screenshots. At reconciliation time browser
execution is pending; source presence is not successful execution evidence. Require
same-source actual report, network/source provenance and observed parent drain.
An engine review or independent focused probes do not replace native D1/Node
transaction tests, expiry/GC scheduling integration, full engine gate and actual
browser tests. Keep maintenance integration findings open until fixed and
independently evidenced, without representing proposed fixes as security proof.

Deferred: new room federation; guest QR participants; optional opaque provider
picker; provider-resistant peer authentication (requires cryptographic SDP/DTLS
transcript binding); TURN pricing/NAT success; TV/media compatibility; guaranteed
background mobile execution; a full Bridal daemon's command policy. Paid-initiator
sponsorship versus both-participant entitlement remains commercial policy pending
review, not an implicit free recipient entitlement. Portable self-hosting must not
require Polar or this hosted service.

## Reference daemon security-state retention

Individual device disconnection first commits denial and pending cleanup together.
Native cleanup is bounded and retried automatically. Pending cleanup is shown as
Disconnecting rather than falsely reporting completion. Issuance reserves an
owned record before minting credentials, so interruption cannot leave an untracked
credential family. Completed disconnections release the active-device allowance.

Device-family denial records cannot simply expire when access tokens expire:
already accepted work may retain their lineage. The reference implementation
therefore keeps a paged owner index and deletes these records only during the
trusted final account-erasure phase after native user deletion. Its initial
engineering guard permits1024 historical device families/account, with a bounded
constructor setting up to4096; reaching it refuses new device enrollment without
evicting existing authority. This is an implementation capacity guard, not a
protocol constant or an unlimited lifetime-enrollment promise. General legacy
non-device fence migration and distributed storage scaling remain separate work.
