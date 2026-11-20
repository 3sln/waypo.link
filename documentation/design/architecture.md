# Portable identity and optional services

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.


| Boundary | Belongs here | Does not become a requirement of the other layers |
| --- | --- | --- |
| Identity standards and Waypo service extensions | Issuer/client binding, authorization and discovery messages, scoped renewable authority, signaling proof/replay contracts, opaque log cursors, retention revisions and errors | A hosting vendor, UI toolkit, billing plan or physical database layout |
| Reference implementation | ngin engines, Better Auth integration, Dodo user/admin PWAs, granular staff grants, quorum policy, Snug stream codec, Node/Workers adapters and bounded operational limits | A requirement that independent providers use those libraries or the same internal grant tables |
| Waypo.link hosted composition | Branding, Polar, commercial storage/trial limits, contact/retention policy and supported signup markets | A paid subscription, Cloudflare account or Waypo.link dependency for self-hosting |

## Boundaries and login flow

Keep identity/authentication, app authorization, optional services and operator policy separate. Suggested logical modules are identity engines/ports; maintained standards integration; durable Node/Worker adapters; SDK/components; user and admin apps; optional notifications/signaling/logs/blobs/support; independent sample clients. These are import boundaries, not a mandate for a package per concept. Hosted composition supplies commercial policy through public configuration/ports.

An app chooses an issuer, loads supported metadata, begins a purpose-bound authorization transaction, and redirects/opens provider-owned authentication. The provider authenticates a local account or brokers a configured upstream provider, obtains app-specific consent, then returns a one-use authorization code. The client exchanges with PKCE where applicable and verifies issuer, audience, nonce and callback binding. Upstream credentials terminate at the broker. No upstream email-based automatic linking or cross-issuer account equivalence.

Standard OIDC login must work independently of optional capabilities. URL client metadata is an explicitly supported, version-pinned integration profile with bounded fetch/SSRF, origin/callback and key validation; ordinary OIDC conformance alone does not provide it. The selected maintained components and draft-profile limitations are recorded in [identity components](../implementation/identity-components.md). Unsupported optional capabilities fail clearly without a proprietary hosted fallback.

Browser components use purpose-bound handoff; an app receives only its own app credential. A provider component's private credential, account list and recovery state remain provider-owned. Browser partition/storage/FedCM limitations require actual compatibility tests and redirect/popup fallback; nonextractable keys are not an XSS defense. Native/CLI paths use appropriate standard system-browser/loopback or device authorization flows with purpose/client/transaction binding, rather than exposing a provider browser-session token.

## Optional capability flow

Normal OIDC provider metadata independently advertises each optional capability’s endpoints and versions, not account presence, devices, subscriptions or grants. The [extension guide](oidc-extensions.md) is navigation only; there is no enclosing service registry or aggregate capability protocol. Login alone does not authorize notifications, signaling or storage. Explicit capability consent creates revocable scoped authority independent of a transient first-party browser cookie. Server-side checks cover live account/grant state, credential lineage, quotas and replay. Distinguish browser sign-out from app disconnect and global security revocation.

Notification flow: app submits within its approved scope → provider checks authority/budget → user-controlled routing/suppression/digest → bounded delivery outbox → configured channel. Mandatory security and retention notices remain a separate purpose that app routing cannot suppress.

Signaling flow: approved endpoints establish an explicit invitation/recipient capability → sender's provider checks app/user authority → authenticated provider routing → recipient provider checks purpose/permission → bounded setup messages reach an approved endpoint. No public device enumeration. Signaling is not TURN, media relay, or guaranteed connectivity; withdrawing signaling cannot remotely terminate already established peer connections. Federation wire contracts remain to be specified/tested independently.

## App-private ordered logs and files

An approved app can share state across one user's devices using opaque ordered logs and a separate key/blob store. The provider derives issuer/account/client namespaces from verified authority. Apps cannot enumerate another app's resources; account switching partitions local state and unsent intents too. Logs and blobs are independently discoverable and consented.

The app owns its reducer or CRDT. Flow: save an immutable local intent → append with its durable operation ID → provider atomically commits entry/receipt/quota → replay or tail from the app's last processed cursor → commit reducer state and cursor together → acknowledge. Reconnect can repeat unprocessed items. Out-of-retention cursors fail explicitly, preserving local recovery data. [Log semantics](log-semantics.md) describe ordering and retry guarantees.

A log consumer can conditionally trim strictly before an explicit committed cursor using a retention revision. There is no blanket clear or public provider-checkpoint operation. The provider moves stable prefixes between bounded transactional storage and immutable objects transparently; delayed archive publication cannot restore trimmed data. File keys are independent: creating a blob and publishing its reference are separate operations, and trimming a log does not authorize deleting a file.

The Node adapter uses durable SQLite plus local disk objects. The configured Worker candidate routes account data to separate SQLite actors with R2 objects, while Native identity and grant authority remain on the installation control actor. Signed route/work receipts bind account, generation, caller and operation. Reserved physical slices and bounded paid work protect the same installation wallet; owner export and essential cleanup have included protected floors. Actual lifecycle, revocation, idle cleanup, hibernation and hosted capacity qualification remain required before release. This is a reference topology, not a wire-protocol dependency.

A saved identity remains useful offline and temporary transport failure must not log the user out. Cached presentation is not remote authority. Show local, synchronized, disconnected, quota and recovery states accurately. Stored app data is not end-to-end encrypted; the provider can read it. Browser eviction remains possible. Identity credentials, grants and monetary balances are never merged as application CRDT state.
