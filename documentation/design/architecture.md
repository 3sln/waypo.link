# Portable identity and optional services

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.


| Boundary | Belongs here | Does not become a requirement of the other layers |
| --- | --- | --- |
| Identity standards and Waypo service extensions | Issuer/client binding, authorization and discovery messages, scoped renewable authority, signaling proof/replay contracts, document epochs and errors | A hosting vendor, UI toolkit, billing plan or physical database layout |
| Reference implementation | ngin engines, Better Auth integration, Dodo user/admin PWAs, granular staff grants, quorum policy, Yjs codec, Node/Workers adapters and bounded operational limits | A requirement that independent providers use those libraries or the same internal grant tables |
| Waypo.link hosted composition | Branding, Polar, commercial storage/trial limits, contact/retention policy and supported signup markets | A paid subscription, Cloudflare account or Waypo.link dependency for self-hosting |

## Boundaries and login flow

Keep identity/authentication, app authorization, optional services and operator policy separate. Suggested logical modules are identity engines/ports; maintained standards integration; durable Node/Worker adapters; SDK/components; user and admin apps; optional notifications/signaling/sync/support; independent sample clients. These are import boundaries, not a mandate for a package per concept. Hosted composition supplies commercial policy through public configuration/ports.

An app chooses an issuer, loads supported metadata, begins a purpose-bound authorization transaction, and redirects/opens provider-owned authentication. The provider authenticates a local account or brokers a configured upstream provider, obtains app-specific consent, then returns a one-use authorization code. The client exchanges with PKCE where applicable and verifies issuer, audience, nonce and callback binding. Upstream credentials terminate at the broker. No upstream email-based automatic linking or cross-issuer account equivalence.

Standard OIDC login must work independently of optional capabilities. URL client metadata is an explicitly supported, version-pinned integration profile with bounded fetch/SSRF, origin/callback and key validation; ordinary OIDC conformance alone does not provide it. The selected maintained components and draft-profile limitations are recorded in [identity components](../implementation/identity-components.md). Unsupported optional capabilities fail clearly without a proprietary hosted fallback.

Browser components use purpose-bound handoff; an app receives only its own app credential. A provider component's private credential, account list and recovery state remain provider-owned. Browser partition/storage/FedCM limitations require actual compatibility tests and redirect/popup fallback; nonextractable keys are not an XSS defense. Native/CLI paths use appropriate standard system-browser/loopback or device authorization flows with purpose/client/transaction binding, rather than exposing a provider browser-session token.

## Optional capability flow

Public capability discovery advertises endpoints/versions, not account presence, devices, subscriptions or grants. Login alone does not authorize notifications, signaling or storage. Explicit capability consent creates revocable scoped authority independent of a transient first-party browser cookie. Server-side checks cover live account/grant state, credential lineage, quotas and replay. Distinguish browser sign-out from app disconnect and global security revocation.

Notification flow: app submits within its approved scope → provider checks authority/budget → user-controlled routing/suppression/digest → bounded delivery outbox → configured channel. Mandatory security and retention notices remain a separate purpose that app routing cannot suppress.

Signaling flow: approved endpoints establish an explicit invitation/recipient capability → sender's provider checks app/user authority → authenticated provider routing → recipient provider checks purpose/permission → bounded setup messages reach an approved endpoint. No public device enumeration. Signaling is not TURN, media relay, or guaranteed connectivity; withdrawing signaling cannot remotely terminate already established peer connections. Federation wire contracts remain to be specified/tested independently.

## App-private synchronization and attachments

The same signed-in user can synchronize documents across devices of one approved app. Different users/apps cannot enumerate or access each other's namespaces. No cross-person document sharing in the initial feature. Namespace keys derive from verified issuer/user/client/grant/platform binding, not caller prefixes or an Origin header alone. Account switching partitions local replicas/outboxes too.

Use an explicit asynchronous/local-first document API, not transparent monkey-patching of Web Storage/IndexedDB. Show saved-locally, synchronized, disconnected and recovery-required states. Browser eviction is possible. No end-to-end encryption claim: the provider can read stored data. Identity credentials, grants and monetary balances are not CRDT-merged authority.

Current Worker placement is one installation Durable Object for identity and service metadata, with private R2 objects. It is not a per-user-DO implementation or a demonstrated high-volume topology. A future per-account services DO split needs an explicit live-grant/revocation contract before moving authority across objects. See [adapter and capacity boundaries](../implementation/durable-adapters.md). Signaling never needs to load CRDT documents. Private object storage holds immutable structural CRDT snapshots and attachments; transactional metadata holds catalogue, epochs, snapshot cut/pointer, durable accepted patch tail and dedup/quotas; memory holds only bounded active document models. Preserve equivalent durable semantics on Node. Physical placement is not public identity.

Edit flow: validate authority/namespace/size/work → load snapshot+tail as needed → validate patch against engine/schema limits → commit accepted patch/dedup/sequence durably → acknowledge/broadcast. Replays deduplicate. Eviction can reconstruct acknowledged state; memory alone never holds an accepted edit. Checkpoint upload finishes and verifies before an atomic newer-pointer publication; only its covered journal prefix becomes collectible. A materialized JSON value is not a structural CRDT snapshot.

Separate file uploads reserve capacity, stage privately, verify length/type/hash, then finalize an immutable namespace-owned attachment. References do not replace current access authorization. Deletion/recreation changes epoch; delayed uploads, patches or snapshots cannot revive old objects. Offline/old-epoch clients retain recoverable local edits and explicitly rebase/export rather than silently losing or applying them.

Yjs structural updates are selected, with an explicit text/map/array transaction SDK and a browser IndexedDB adapter using short Web Locks for shared local commits. Binary update and document limits are reference-profile limits, not an assertion of unlimited IndexedDB compatibility. Journal/checkpoint scheduling, larger attachment catalogues, causal compaction and the measured workload envelope are still being completed. Compaction must preserve valid offline edits or move to a new epoch with recovery/export; materialized JSON cannot replace causal state within an existing epoch. See [state lifecycle](state-lifecycle.md) for mandatory durability/cleanup gates.
