# Local clients, session handoff and pairing consent — design spike

Status: **design spike, 2026-10-27. Provisional (coordinator) and not signed off by the owner.** Nothing here is implemented, and no specification is edited by this document. Every decision (LC-1 to LC-14, §7) and change request (CR-L*, CR-A*, §8) is a proposal. The coordinator records it in [DEVLOG](../../DEVLOG.md). Examples use `acme.example` (vendors), `provider.example` (a Bindle provider) and placeholder identifiers under `https://spec.bindle.example/`.

Spike sign-off: reviewer ___ / date ___ / outcome ___.

**Owner direction (2026-10-27, summary of the verbatim request):** explain why both [device-login](../spec/device-login.md) and [device-authorization](../spec/device-authorization.md) exist, and how these logins show up in the user's interface. A CLI or daemon login is unlike a browser login: the CLI or daemon is **its own integration** and declares its own preference fragment dependencies, as an app hosted on `localhost:*` or `*.localhost` should. Separate the login **mechanism** (OAuth/DPoP versus a normal 3sln.me login) from the **use case** (handing a phone's login to a TV's browser, versus a CLI, daemon or local-integration login). Cover all of them, including local web apps, securely. For pairing, the user consents to every single app connection: the daemon and each app connecting to it are granted access individually. The owner was unsure whether a pairing can be an RPC (preferences-assignable) resource.

Read with: [auth](../spec/auth.md), [runtime profile](../spec/federation-implementation.md), [protocol §1–§2](../spec/protocol.md), [integrations §2](../spec/integrations.md#2-integration-manifest), [extensions §5](../spec/extensions.md#5-occupancy-consumption-and-consent), [linked approval](linked-approval.md), [signaling §5.4–§5.9, §14.1, §20.1.4, §20.11](../spec/signaling.md).

## 1. Why there are two documents

### 1.1 What each one is

| | [device-login.md](../spec/device-login.md) | [device-authorization.md](../spec/device-authorization.md) |
| --- | --- | --- |
| What it is | 3sln.me account policy: passkeys, owner-session management and the original QR "sign in with another device" flow. | A Bindle interop profile: RFC 8628 device grant with mandatory DPoP, for **clients**. |
| Result | A provider owner session (a full 3sln.me login) on another browser. | A DPoP-bound app client session holding fragment grants. |
| Interop | None. Its own text says it is "not a claim of OAuth device-grant interoperability". | Normative, declared as `device-authorization.v1`. |
| Relation | Not superseded. Its session-handoff flow is generalized by the `session` kind of [linked approval](linked-approval.md) (LA-1, LA-13); its passkey and session rules are current 3sln.me policy. | Does not cover session handoff and does not replace device-login (its §1, as corrected). |

The two overlap only because [linked approval](linked-approval.md) serves both from one code namespace and one `/approve` page. That is a 3sln.me implementation choice, not a relation between the specs.

**The old supersession note was wrong, and has been corrected (coordinator, 2026-10-27).** device-login.md used to call device-authorization "the proposed successor for interoperable device grants". Device-authorization §1 puts provider-local cross-device sign-in out of scope, so it succeeds nothing in device-login. The note came from linked approval §14 ("Coordinator" row: "`device-login.md` supersession note"), which planned a note about the QR flow moving to linked approval's `session` kind, and the note was written against the wrong document. device-login.md now says it is session handoff for the reference service and is not superseded by device authorization. device-authorization §1 now cross-links it and says it does not replace it. The structural cause remains: a 3sln.me policy document sits in `docs/spec/` beside the Bindle spec it was confused with. §1.3 removes that cause.

### 1.2 Two axes

The confusion comes from naming documents after a mechanism ("device") when the documents differ in use case. These are separate axes.

**Mechanisms** (how a credential is obtained):

| ID | Mechanism | Credential | Spec |
| --- | --- | --- | --- |
| M1 | First-party sign-in on the provider origin (passkey, password, email link, recovery) | Provider owner session (cookie) | auth, device-login (passkeys) |
| M2 | Session handoff: a signed-in browser approves a code shown by another browser | Provider owner session on the other browser, bounded by the approver | linked approval `session` kind (host policy) |
| M3 | OAuth code + S256 PKCE, HTTPS redirect (redirect, popup or FedCM presentation) | App client session | auth, runtime profile |
| M4 | OAuth device grant + mandatory DPoP | DPoP-bound app client session | device-authorization |
| M5 | OAuth code + PKCE with a **loopback** redirect ([RFC 8252 §7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3), any port) + mandatory DPoP | DPoP-bound app client session | **none yet**. Proposed here (§2) |
| M6 | OAuth code + PKCE with a claimed HTTPS redirect (universal or app link, RFC 8252 §7.2) | App client session | auth (an HTTPS redirect is already allowed) |

**Use cases** (what the person is doing):

| ID | Use case | Mechanism | Ends with | Can do | Client identity | Listed in (proposed, §3) |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | Hand my signed-in session to another browser (TV, borrowed laptop) | M2 | Provider owner session, expires no later than the approving session | Everything the console can do; sensitive actions need its own step-up (LA-7) | None: it is the provider's own console | **Devices** |
| U2 | CLI tool | M5 when a browser runs on the same machine, else M4 | DPoP-bound client session, per installation | Its approved fragments, methods and slot consumption | Installation key (§2.2) | **Connected apps → On your devices** |
| U3 | Long-running daemon or agent | M4 (usually headless), or M5 at setup | As U2. May be a standing device grant (AMD-SG-D1) | As U2, plus signaling endpoints and pairings | Installation key | **Connected apps → On your devices** |
| U4 | Local web app on `http://127.0.0.1:*`, `http://[::1]:*`, `http://localhost:*` or `http://*.localhost:*` | M5 (redirect to its own loopback origin) | DPoP-bound client session, key held by the page origin | As U2 | Installation key; the origin is a transport fact | **Connected apps → On your devices** |
| U5 | Native desktop or mobile app | M6 when the vendor registers an HTTPS client; otherwise M5 (desktop) or M4 (TV, console) | App client session | As U6 for M6; as U2 otherwise | M6: vendor's HTTPS `client_id`. M4/M5: installation key | M6: **Connected apps** under the vendor host. Otherwise as U2 |
| U6 | Public hosted web app (baseline) | M3 | App client session (Bearer or DPoP) | Approved fragments, slots, intents, occupancy if confidential | HTTPS `client_id` (registered or metadata document) | **Connected apps** under the verified host |

A third-party TV *app* is U5 through M4. A TV *browser* signing in to 3sln.me itself is U1 through M2. They share the `/approve` page and nothing else.

The [MCP service](../spec/mcp-service.md) is a separate 3sln.me authorization server with its own grant namespace and operator-registered clients only. Local MCP clients are a case of U2/U5. This spike does not change it; LC-14 recommends adopting the same local-client rules there later.

### 1.3 Document restructure (proposal; no files are moved by this spike)

This follows the coordinator's provisional layout (2026-10-27): `docs/spec/` holds **Bindle core** only, `docs/spec/extensions/` holds **Bindle extension** specs, and `docs/3sln/` holds **3sln.me reference-service** documents (provider policy, interface, hosted account rules, lifetimes and limits, release gates). The test for placement is whether a second, independent provider or client would need the text to interoperate. If it would, the text is Bindle. If only 3sln.me needs it, it is 3sln.me.

**Placement.**

| Proposed path | Title | Group | Content and source |
| --- | --- | --- | --- |
| `docs/spec/auth.md` | Authentication and application authorization | Bindle core | Identity and discovery, application authorization (code + PKCE, transports, key binding), client sessions and the lifetime **ceilings** (≤ 15 min Bearer, ≤ 60 min DPoP, rotation, live checks). Keeps only the interoperable parts of today's auth.md. |
| `docs/spec/device-authorization.md` | Device authorization grant (`device-authorization.v1`) | Bindle core (optional feature) | Unchanged in substance, plus CR-A3 (local clients eligible). |
| `docs/spec/local-clients.md` (new) | Local clients (`local-clients.v1`) | Bindle core (optional feature) | The interoperable rules of §2.3: identifier, proof at request, local manifest, M5 loopback rules, CORS, no inheritance, capabilities, unverified labelling as a MUST. No interface and no lifetime values. |
| `docs/spec/extensions/signaling.md` | Signaling (`signaling.v1`) | Bindle extension | Today's signaling.md, with CR-L1 to CR-L10. Pairing rules P1–P5 live here. |
| `docs/3sln/accounts/sign-in-and-sessions.md` | Sign-in, passkeys and browser sessions on 3sln.me | 3sln.me | The passkey and owner-session parts of device-login.md, plus the 3sln.me parts of auth.md: "3sln email materialization", "Hosted recovery-file transaction" and the reference-host details under "Passkeys". |
| `docs/3sln/accounts/approve-a-sign-in.md` | Approve a sign-in: session handoff and app sign-in with a code | 3sln.me | Today's linked-approval.md (moved and renamed), absorbing device-login.md's session-handoff text. Its `session` kind is named **session handoff** and its `app` kind **app sign-in with a code**, in headings and user-facing text. It holds the `/approve` page, the 3sln.me binding of device authorization and the presentation of local-client approvals (§2.3 rules 11–13). |
| `docs/3sln/accounts/devices-and-connected-apps.md` (new) | Devices and connected apps | 3sln.me | The interface rules of §3.2 (Devices, Connected apps, "On your devices", revocation cascades). |
| `docs/3sln/accounts/app-session-policy.md` (new) | App session lifetimes and limits on 3sln.me | 3sln.me | The reference-host values now inside auth.md and linked approval §7 (180-day idle, `APP_*` settings, durations offered at approval) and the local-client values of §2.3 rules 15–16 (30-day idle, standing-mark eligibility). |
| `docs/3sln/services/mcp.md` | 3sln.me MCP service | 3sln.me | Today's mcp-service.md, which already says it is not Bindle. |
| `docs/spec/device-login.md` | (stub, one release) | — | Two lines: "Moved. Passkeys and sessions: sign-in-and-sessions. Session handoff: approve-a-sign-in. Not related to device authorization." Then delete. |

This spike becomes design history (`docs/3sln/design/`, or wherever the coordinator files architecture rationale) once its decisions are adopted.

**Cross-links each document must carry.** Every document opens with a fixed header: `Group:` (Bindle core, Bindle extension or 3sln.me reference service), `Covers:` (the use cases from §1.2), `Does not cover:` (each neighbouring use case, with a link to where it is covered). The required links are:

| Document | Must link to |
| --- | --- |
| auth.md | device-authorization (M4) and local-clients (local clients, M5), both as normative siblings. Informatively: sign-in-and-sessions, for how one provider runs its own sign-in. |
| device-authorization.md | auth and local-clients (normative). "Does not cover: session handoff", linking approve-a-sign-in informatively, with the sentence "a provider-local session handoff is not this grant and is not replaced by it". |
| local-clients.md | auth, device-authorization, protocol §1–§2 (normative). Informatively: devices-and-connected-apps, as one provider's presentation. |
| signaling.md (extension) | device-authorization and local-clients from §5.9 (normative). Its interface references in §14.1 stay presentation-neutral and may link devices-and-connected-apps only as an example. |
| sign-in-and-sessions.md | approve-a-sign-in (session handoff), devices-and-connected-apps. "Does not cover: app grants", linking auth and device-authorization. |
| approve-a-sign-in.md | device-authorization and local-clients (the Bindle rules its `app` kind implements), sign-in-and-sessions (what a handoff session is), devices-and-connected-apps, app-session-policy. |
| devices-and-connected-apps.md | sign-in-and-sessions, approve-a-sign-in, app-session-policy; informatively, signaling §14.1 for the owner controls it presents. |
| app-session-policy.md | auth §"Token lifetime and client sessions" and device-authorization §7 (the ceilings it stays within). |

**Rules that keep the confusion from recurring.**

- A Bindle document never depends normatively on a 3sln.me document. It may link one only as an informative example. A 3sln.me document may cite Bindle normatively.
- A supersession note may name only a document **in the same group that covers the same use case**. Anything else is written as "Does not cover: …, see …".
- Each document names itself by use case. Mechanism words ("device", "QR", "code") never stand alone in a title.
- A spec status line says which implementation exists and where its 3sln.me policy lives, rather than carrying that policy inline (today's auth.md and runtime profile mix in `APP_*` values and reference-host choices).

## 2. Local clients as first-class integrations

### 2.1 The problem

A **local client** is software that runs on the person's own device and cannot be identified by a public HTTPS origin it controls: a CLI, a daemon, a local web app, or a native app without a vendor HTTPS registration. Today:

- auth allows `localhost` HTTP redirects only in an explicit development configuration;
- client ID metadata documents require HTTPS, a public DNS host and no `localhost` (runtime profile, "ID syntax");
- protocol §1 requires application identifiers to be HTTPS URLs;
- linked approval §5.2 refuses the device grant to every client except operator-reviewed ones.

So a local client can sign in only if an operator registers it. The owner wants it to be its own integration, declaring its own fragments, methods, purpose and slots, without a public HTTPS identity.

### 2.2 Options for identity and declaration

| Option | How | Gives | Fails at |
| --- | --- | --- | --- |
| **I1. Self-asserted manifest, bound to an installation key** | The client generates a DPoP key at install. Its `client_id` is the [RFC 9278](https://www.rfc-editor.org/rfc/rfc9278.html) JWK thumbprint URI of that key. The request carries a local manifest (the `bindle_integration` subset it may use, plus presentation hints). The provider snapshots and pins the manifest at approval. | A stable identity per installation across sessions, with no registration, no fetch and no SSRF surface. Approvals are keyed to something only that installation can prove. | Says nothing about *which software* it is. Every name is a claim. |
| **I2. Vendor HTTPS metadata document named by the local client** | The client points at `https://acme.example/cli/client.json`, which lists device-grant or loopback use. | A vendor-authored manifest and a recognizable host. | Proves nothing about the requester: any program can name any public `client_id` (device-authorization §3, §10.2). Showing the vendor host as an identity invites impersonation. |
| **I3. Loopback origin as identity** (U4) | Treat `http://localhost:5173` as the client. | Familiar to web developers. | Ports and names are claimable by any local process, and reused across unrelated apps. The origin is not an identity. |

**Recommendation (LC-3):** I1 for every local client. I2 is deferred and, when added, is only a *publisher claim* shown as unverified and usable as a provider policy input (for example a fragment allowlist), never as identity or a badge (LC-6). I3 is rejected as identity; the origin of a local web app is recorded as a transport fact for CORS and redirect checks (LC-10).

### 2.3 Rules for local clients (proposed `local-clients.v1`)

Identity and declaration:

1. **Identifier.** A local client's `client_id` is `urn:ietf:params:oauth:jwk-thumbprint:sha-256:<thumbprint>` of its DPoP public key (RFC 9278, RFC 7638). The request's `dpop_jkt` MUST equal that thumbprint. One key is one installation.
2. **Proof at request time.** The authorization request (M5) and the device authorization request (M4) MUST carry a DPoP proof for that key. The provider refuses a local-client request without one. Without this rule, anyone could make the approval page claim to be an installation the owner already approved.
3. **Local manifest.** The request carries `bindle_local` (JSON text, at most 8 KiB) with exactly these members: `v` (1), `name` (presentation, at most 64 code points, the same character screen as `client_name`), `kind_hint` (`cli`, `daemon`, `web`, `native` or `other`; presentation only), `setup.fragments` and `extensions` (integrations §2.2 shapes), and `intents` limited to session kinds without `route` (CR-L8). Unknown members are ignored. Members that need a confidential client (`events_endpoint`, `resources`, an `occupant` extension) are refused, as integrations §2.1 already requires.
4. **Snapshot and change.** The provider pins the manifest's canonical digest in the connection at approval. A later request from the same key with an equal or narrower manifest is adopted. A wider one is staged for owner review exactly as integrations §2.3 treats widening. It never widens a grant without fresh consent.
5. **Never inherited.** A local client never shares or inherits anything belonging to another client: grants, intents defaults and exclusions, session handler approvals, pairings, suppression state, or an "already approved" shortcut. Each installation key is a separate connection, even when two installations present identical manifests.
6. **Capabilities.** A local client may request fragments and methods, consume slots (`application` consumer), and hold session handler approvals. It may not occupy slots, contribute brokered resources or receive events (all require a confidential client). It may not be an intent handoff target, a chooser candidate, an embedded (island) client or a FedCM client.

Mechanisms:

7. **M5 for clients with a browser on the device.** Authorization code with S256 PKCE, `dpop_jkt` in the authorization request (RFC 9449 §10), and a DPoP proof at code exchange and every refresh. `redirect_uri` is `http` on a loopback host with any port, path fixed by the request.
   - **Without an `Origin` header** (CLI, daemon, native): the host MUST be the IP literal `127.0.0.1` or `[::1]` (RFC 8252 §8.3). The port is not compared at the token endpoint beyond the request's own value.
   - **With an `Origin` header** (local web app, U4): `Origin` MUST be a loopback origin (`127.0.0.1`, `[::1]`, `localhost` or a single label under `.localhost`, any port), and `redirect_uri` MUST be on exactly that origin. A non-loopback `Origin` is refused for every local-client request.
   - The client MUST open the system browser, never an embedded web view (RFC 8252 §8.12).
8. **M4 for headless clients.** Device-authorization applies unchanged, with local clients eligible (CR-A3). Code typing stays the default (LA-5, LA-6).
9. **Choice.** A client SHOULD use M5 when a browser runs on the same device, because a loopback redirect cannot be phished remotely: the code is delivered to the victim's own machine. M4 remains available for headless use, with its remote-phishing limitation (device-authorization §10.1).
10. **CORS.** With the feature on, the authorization-request, token, revocation and RPC endpoints answer CORS only for loopback origins, and the actual request is accepted only when its `Origin` equals the origin recorded for that local client at approval.

Approval and lifetime:

11. **Labelled unverified.** Every approval, grant, notification and audit surface labels a local client as **an unverified app on your device**. Its `name` appears only as "Name it gives itself (not verified)", bidi-isolated, and never in notifications or email. When `name` matches the name or host of a reviewed or connected HTTPS client, the approval page says that this program claims to be that app and that the vendor has not confirmed this copy.
12. **Fresh, explicit approval.** Device-authorization §5.1 applies to both M4 and M5: fresh credential authentication, explicit account choice, no approval on navigation, at most once. For M5, re-authorization by an already approved installation (proven by rule 2) may show "approved on *date*", but never skips consent for anything not already granted.
13. **Owner-authored label.** Approval requires the owner to name the installation and its device group ("Work laptop" / "deploy CLI"). The device group can be chosen from groups the owner used before. The provider also shows a short fingerprint derived from the key thumbprint. No app-supplied text prefills these fields.
14. **Sensitive fragments.** Fragments or methods in the sensitivity categories of [incremental authorization §8.3](../spec/incremental-authorization.md#83-sensitivity-categories) need a second explicit confirmation for local clients.
15. **Lifetime.** The client session follows device-authorization §7 with a shorter idle limit for local clients: RECOMMENDED 30 days (provider-configurable, at most 90). The owner may choose 1 hour, 8 hours or "until revoked". Access tokens are DPoP-bound, at most 60 minutes. Lineage and live checks apply on every refresh and RPC.
16. **Standing grants.** AMD-SG-D1 standing marks MAY be offered to local clients, never to a `web` origin client (rule 10; a page origin is shared by everything served there), and never on an approval completed without typing the code.
17. **Post-approval notice.** As LA-10, naming the client as "an unverified app on your device" plus the owner label, never `name`.

### 2.4 Threats

| Threat | Rule that addresses it | Residual risk |
| --- | --- | --- |
| Any local process can bind a loopback port or claim any name | Identity is the key, not the port or name (1, 3). Names are unverified (11). Each installation is approved separately (5). | A local process the owner approves gets what was approved. Same-user malware is outside the provider's boundary. |
| Impersonating a public app's name or riding its approvals | Distinct identifier namespace. Nothing inherited (5). Claim warning (11). Never in notifications (17). | An owner who ignores the warning approves the impostor. |
| A malicious web page drives a localhost flow | A non-loopback `Origin` is refused for local-client requests, and a page cannot omit `Origin` on a cross-origin POST (7). The page cannot read a code redirected to loopback. | None known beyond device-authorization §10.1 for M4. |
| DNS rebinding to a loopback address | Rebinding keeps the attacker's hostname as `Origin`, which is not a loopback origin, so it is refused (7). | A resolver that sends `*.localhost` to DNS (non-conforming) lets a remote site pose as a local web app. The owner still sees an unverified local approval. Clients SHOULD prefer IP literals. |
| Code interception on loopback | PKCE plus `dpop_jkt` in the authorization request: an intercepted code is useless without the verifier and the private key (7). | None for the code. |
| QR or code substitution (M4) | Code typing by default (LA-5, LA-6, device-authorization §10.6). | As device-authorization §10.6. |
| Long-lived daemon key theft | DPoP binding of every token (7), non-exportable keys SHOULD be used (device-authorization §8), 30-day idle (15), "new network since approval" signal and revocation (§3). | A stolen key and refresh token work until noticed or idle. |
| One local app rides another's grant | Separate keys mean separate grants (1, 5). Refresh tokens are bound to their key. | Two apps served from one loopback origin share browser storage and so share a key. This is disclosed for U4, and standing marks are refused for `web` clients (16). Developers SHOULD give each app its own `*.localhost` name. |
| Confused approval among look-alike local clients | Owner label and device group (13), fingerprint, "approved on *date*" only with key proof (12), grouping in Connected apps (§3). | An owner who labels carelessly. |
| Request in an existing installation's name, to borrow its approvals | Proof of key at request time (2). No consent shortcut (12). | None. |
| Remote device-code phishing of a local client (M4) | As device-authorization §10.1, plus local-client labelling (11) and pairing confirmation (CR-L5). | As device-authorization §10.1. Prefer M5 (9). |

### 2.5 Local daemons serving local pages (client guidance, non-normative)

A daemon that exposes its own HTTP API on loopback is a target for DNS rebinding and cross-site requests from pages in the same browser. This is outside the Bindle protocol, but a client SDK SHOULD document the following. Check `Host` against an allowlist of loopback names. Require a non-simple header or token on every request. Never accept a Bindle token from a page.

## 3. How each shows in the user's interface

### 3.1 What exists now (local, behind flags, not production-verified)

- **Security page** (`apps/web/src/ui/release-security.mjs`), with `deviceAuthorizationEnabled`:
  - **Signed-in devices** (`ui/devices.mjs` `devicesPanel`): owner sessions with an owner-editable label (default "Browser session"), a "This device" badge, "Approved from …" lineage, last used, lifetime, Rename, Revoke and "Sign out other devices". Revocation shows the cascade to approved devices and apps.
  - **App sign-ins and access** (`devicesApps`): app client sessions from `/api/app-sessions` (`packages/federation/session-inventory.mjs`) plus active preference grants. Each row shows the host parsed from the client origin, a "Signed in with a code" badge for device-grant sessions, lineage, last used, lifetime and the fragment URL, with Revoke.
- **Connected apps** (`ui/release-mcp.mjs`): app connections and the separate MCP "agent logins".
- **Apps & integrations** (`ui/connections/`): built-in and third-party connections by verified host, roles (slots) and occupants, setup, pause and disconnect. CX-3 access views (`ui/access/`) give per-app, per-fragment, per-resource and per-bus detail.
- Gap: `appLabel` uses `new URL(client.origin ?? clientId).host`. For a JWK thumbprint URI that host is empty, so a local client would render as a blank name. Phase 1 must fix this.

### 3.2 Proposed

**Devices** holds provider sessions only: credentials that act as the owner in the console.

| Row | Shows | Actions |
| --- | --- | --- |
| A normal sign-in | Owner label, this-device badge, last used, ends | Rename, revoke |
| A handed-off session (U1) | As above, plus "Signed in with a code from *Pixel 8*" and the chain | Revoke (cascades) |
| Cross-link | "3 apps were approved from this device", linking to Connected apps filtered by "approved from" | — |

**Connected apps** holds grants: everything that acts as an app with scoped access.

- **Web and hosted apps** (U6, and U5 through M6): one card per connection, by verified host. Expanding it shows each client session ("signed in on *Work laptop*, last used …"), fragments and methods, slots consumed, session kinds approved, pairings and live offers.
- **On your devices** (U2–U4, and U5 through M4/M5): grouped by the owner's device group, then by installation.

Each local installation row shows:

| Element | Source |
| --- | --- |
| Owner label, with an "Unverified app on your device" badge | Owner, at approval (rule 13) |
| "Name it gives itself (not verified)", kind hint | Local manifest (presentation only) |
| Key fingerprint | Thumbprint |
| How it signed in: "code on another device" (M4) or "this device's browser" (M5); for U4, its loopback origin | Grant record |
| Approved from (device), approved on | Lineage |
| Fragments and methods held, slots consumed, session kinds | Grants and approvals |
| Pairings it is party to, each with the other party, kind, `opens`, expiry | Pairing records (§4) |
| Last used (last refresh); "used from a new network since approval" | Provider request records (AMD-SG-D1 signal) |
| Lifetime: ends *date*, or "until revoked, stops after 30 days unused" | Client session |
| Standing: yes or no, with what ends it | AMD-SG-D1 |
| Revoke (ends tokens, endpoints, sessions and its pairings); revoke all in this device group | — |

Rules (3sln.me policy):

- A local installation is never listed under a vendor host, even when its name claims one.
- Revoking from Devices cascades to apps approved from that session, after the existing warning. Standing grants are exempt only as AMD-SG-D1 states.
- One owner-facing name per installation. Signaling's `endpoints({pairing})` label (§5.8) uses the owner label.
- MCP agent logins stay in their own section until LC-14 is decided.

## 4. Pairing consent

### 4.1 What the current draft already does

[Signaling §5.8](../spec/signaling.md) defines a pairing as an owner record with exactly one `local` side and one `peer` side for one kind. It needs each own-entity app's session handler approval and slot grant. Until those approvals exist it stays pending, and goes live when the other app is approved, provided the approval page names the pairing. §5.9 lets the device-authorization approval page offer a pairing with one peer app. §5.8 lists the events that delete it.

**Gaps against the owner requirement:**

- **G1.** Activation is bundled into another decision. Approving the other app activates a pending pairing once the page *names* it, so the owner never makes a separate decision about that connection.
- **G2.** §5.9 offers one pairing on the enrolment page. Connecting a second app to the daemon has no defined path except settings, and nothing says that each app connection is a separate consent.
- **G3.** A daemon must enroll as an operator-reviewed or metadata-document client (§5.9 step 1), so it is not its own integration.
- **G4.** Pairings are listed in "app access" and headless clients in "Devices" (§14.1). Neither party's row shows the connection.

### 4.2 Options

**(a) Pairing as a slot assignment.** A per-kind slot (for example `paired-endpoint/<kind>`) whose occupant is the daemon's endpoint. Each app consumes the slot with per-consumer approval (extensions §5.2).

**(b) Pairing as a preferences-assignable resource.** The signaling occupant mints a resource per paired endpoint (or client session and kind) implementing a contract such as `…/contracts/signaling-target/v1`. An app requests a fragment field of that contract. The owner assigns the daemon's resource, and each consumer approves it individually (AMD-C3 projections). Revoking the grant or re-enrolling (a generation change) ends access.

**(c) The standalone owner record (§5.8), restated as a per-edge grant.** Keep the record. Make every edge an individual consent, require each party's own grants, and show the edge on both parties' rows.

| Criterion | (a) slot | (b) RPC resource | (c) per-edge record |
| --- | --- | --- | --- |
| Every app connection consented individually | Yes, per consumer | Yes, per consumer resource approval | Yes, one record per edge, with explicit activation (CR-L1) |
| Revoking either side ends it | Yes | Partly. Revoking the consumer's grant ends it. Revoking the daemon needs a generation change that every consumer's resource token observes. | Yes (§5.8 deletion list) |
| No occupancy oracle | Slot rule §9.8 | `requiresConsent` reveals a pending assignment to the entity's own app only | `endpoints({pairing})` only to a covered opening side |
| Own entity and cross entity | Own only: another entity's endpoint cannot occupy my slot | Own only: resources are entity-owned, so cross-entity still needs the relation record. Two representations. | Both |
| Fits "core = identity, preferences, intents, resources" | Poorly. An occupant must be a confidential integration with HTTPS endpoints, and selection policies mean nothing here. | Well in form: it reuses resources and grants. | Yes. The record is extension-local, and core is untouched. |
| Keeps signaling semantics out of core | No. Needs a slot per kind or new slot members. | Only partly. Direction (`opens`), automatic acceptance, expiry, kind-version pinning and the confirmation code have no resource-scope equivalent. They would go into a bespoke contract that duplicates the record, or leak into resource scoping. | Yes |
| Works for local daemons | No: a public client cannot occupy | Yes | Yes |

**Recommendation (LC-11): (c).** (b) is the closest fit to the owner's suggestion, and it does give per-consumer approval and revocation for free. It fails on three counts. It cannot represent cross-entity pairings, so the same idea would need two representations. A pairing's semantics are not resource semantics, so they would either leak into core resource scoping or sit in a contract that re-implements the record. And shared preference fields apply their scope to every consumer, while a pairing is per edge. The per-consumer property the owner wants can be had in (c) by rules (CR-L1 to CR-L3), and the grant-style listing by interface (§3.2, CR-L7).

When a daemon wants to expose *methods* to apps, rather than a transport, the right primitive is a resource it contributes ([resource contributions](../spec/resource-contributions.md)) and apps consume through preferences. That is (b) used for what it fits, and it does not replace pairing.

### 4.3 Rules for (c)

- **P1. Each party is granted individually.** Every app party (each own-entity side, and the local side of a cross-entity pairing) holds its own live connection, signaling slot grant with methods, and session handler approval for the kind, each recorded by its own owner action. A pairing never creates, implies or extends any of them. A page MAY offer them beside the pairing only as separate, unchecked controls.
- **P2. One edge, one consent.** A pairing names exactly two parties. Connecting a daemon to three apps is three pairings, each created by its own owner action. Nothing admits "any app".
- **P3. Explicit activation.** A pending pairing goes live only through an owner control for that pairing (unchecked, armed after a delay) that names both parties, the kind and `opens`. Approving a party alone never activates it.
- **P4. Visible from both sides.** The pairing appears on both parties' rows in Connected apps (§3.2), and either row can remove it.
- **P5. Unchanged:** coverage, the deletion list, expiry, kind-version re-confirmation, the cross-entity relation basis and the no-oracle discovery rules of §5.8.

## 5. Interaction with linked approval and signaling enrolment

- The `/approve` page serves M2, M4 and (by redirect) nothing else. M5 approval happens on the authorization page, like M3, with the local-client labels.
- A daemon enrolment (signaling §5.9) uses M4 or M5 with a local `client_id`. The approval page MAY offer, as separate unchecked controls: the session handler approval for kinds in the local manifest, the standing mark (AMD-SG-D1), and **one pairing control per already-connected candidate app** (P2). Each pairing still needs activation (P3) and, for an M4 enrolment, the confirmation code (§5.9 step 5).
- For an M5 enrolment the confirmation code is optional: the approval happened in the same device's browser and cannot be remotely phished (CR-L5).

## 6. Phased implementation order

Each phase is engine-first (ngin Actions and Queries, engine-level tests with seeded chaos for races), behind a new `LOCAL_CLIENTS_ENABLED` flag (default off) unless stated otherwise. `npm test` covers SDK, core and server changes; interface phases also need DOM or browser verification. Nothing here is production-verified by implementing it.

1. **Docs (no code).** Apply the §1.3 restructure (moves, splits, headers and cross-links) once the coordinator adopts the layout. The supersession fix is already done. Draft `docs/spec/local-clients.md` from §2.3 as rules only. Record LC decisions in DEVLOG (coordinator).
2. **Identity core.** JWK thumbprint `client_id` validation, DPoP proof at request creation, the local manifest validator and digest pin, the connection keyed by thumbprint, the no-inheritance rule, and the shorter idle limit. Races to test: concurrent approval and revocation of one installation; a manifest widening staged during a live refresh.
3. **M4 for local clients.** Lift linked approval's reviewed-client-only rule for local clients (CR-A3, CR-A6), with the unverified labels, owner label and device group, sensitive second confirmation and notice.
4. **Interface: Devices and Connected apps.** Fix `appLabel`, add the "On your devices" grouping and the cross-links, and move the AMD-SG-D1 signals to the local installation row.
5. **M5 for CLI and native** (IP-literal loopback redirect, no `Origin`).
6. **M5 for local web apps** (loopback `Origin`, CORS, origin recorded at approval).
7. **Signaling pairing changes** (CR-L1 to CR-L10). These land with the `signaling.v1` implementation, which does not exist yet: the local code still implements `rtc-signaling.v1`, with every RTC flag off.
8. **Deferred:** publisher claims (I2), key rotation without re-enrolment, MCP alignment (LC-14).

## 7. Decisions (all provisional, unsigned)

| ID | Decision | Section | Sign-off |
| --- | --- | --- | --- |
| LC-1 | Separate **mechanism** (M1–M6) from **use case** (U1–U6). Documents are named for what they specify. | §1.2 | ___ |
| LC-2 | Documents are placed by group (Bindle core in `docs/spec/`, Bindle extensions in `docs/spec/extensions/`, 3sln.me in `docs/3sln/`) with a fixed `Group / Covers / Does not cover` header and the §1.3 cross-links. device-login.md is split into 3sln.me sign-in-and-sessions and approve-a-sign-in (the moved linked approval). auth.md loses its 3sln.me sections. device-authorization and the new local-clients stay Bindle core. Supersession notes only within one group and use case. | §1.3 | ___ |
| LC-3 | A local client's identity is its installation key: `client_id` is the RFC 9278 JWK thumbprint URI, proven by DPoP at request time. Origins, ports and names are not identity. | §2.2, §2.3 (1–2) | ___ |
| LC-4 | A local client declares itself with a self-asserted local manifest (fragments, slot consumption, session kinds), pinned at approval. Widening follows integrations §2.3. | §2.3 (3–4) | ___ |
| LC-5 | A local client never inherits approvals, defaults, pairings or shortcuts from any other client, including another installation with the same manifest. | §2.3 (5) | ___ |
| LC-6 | Local clients are always shown as unverified apps on your device. Claimed names never appear in notifications. Vendor publisher claims are deferred and display-only. | §2.3 (11), §2.2 | ___ |
| LC-7 | M5 (loopback code + PKCE + DPoP, any port) is added for local clients. IP literals when there is no `Origin`, and the exact loopback origin for local web apps. M4 stays for headless clients, and M5 is preferred where a browser exists. DPoP is mandatory for both. | §2.3 (7–9) | ___ |
| LC-8 | Local clients may consume slots and hold session handler approvals. They may not occupy, broker, receive events, be handoff targets or use islands or FedCM. | §2.3 (6) | ___ |
| LC-9 | Local-client idle limit RECOMMENDED 30 days (at most 90). No standing mark for `web` local clients. A second confirmation for sensitive categories. | §2.3 (14–16) | ___ |
| LC-10 | Local web apps use loopback origins only as a CORS and redirect fact. Shared storage within an origin is disclosed. | §2.3 (7, 10), §2.4 | ___ |
| LC-11 | A pairing stays a signaling owner record (option c), restated as a per-edge grant. The slot and RPC-resource representations are rejected for pairing. | §4.2 | ___ |
| LC-12 | Pairing rules P1–P4: each party granted individually, one consent per edge, explicit activation, visible on both parties. | §4.3 | ___ |
| LC-13 | Devices lists provider sessions (including handed-off sessions). Connected apps lists grants, with local installations grouped by owner-named device group. | §3.2 | ___ |
| LC-14 | The MCP service is unchanged for now. Adopting the local-client rules there is a later decision. | §1.2 | ___ |

## 8. Change requests (not applied)

### 8.1 signaling.md

| ID | Section or decision | Change |
| --- | --- | --- |
| CR-L1 | §5.8 "Pending"; §20.1.4 "names every pending pairing" | Replace activation-by-naming with P3: activation is a separate, unchecked control per pairing. The other party's approval alone never activates it. |
| CR-L2 | §5.8 "Creation"; §5.9 step 3 | Add P1: a pairing never creates or implies a party's connection, slot grant or handler approval. These may be offered only as separate, unchecked controls. |
| CR-L3 | §2 "Pairing"; §5.8 opening paragraph | Define a pairing as a per-edge owner grant between exactly two parties (P2). Fan-out is several pairings. |
| CR-L4 | §5.9 step 1 | The headless client's `client_id` MAY be a local-client identifier (`local-clients.v1`) with its local manifest, instead of a metadata document. Enrolment MAY use M5. |
| CR-L5 | §5.9 step 5 | The confirmation code is required when the bound client session came from the device grant (M4), and optional for M5 enrolments. |
| CR-L6 | §5.8 "Coverage" | Note that a local client's `client_id` is already per installation, so `client_session` binding is implied for it. Coverage is unchanged. |
| CR-L7 | §14.1 rows "Pairings", "Endpoints per app", "Headless clients"; §5.9 "Revocation"; §20.11 "Signals in Devices" and "Revocation" | Headless and local clients, their endpoints, standing status and signals are listed under Connected apps → On your devices, grouped by owner device group. Devices lists provider sessions and cross-links. Pairings appear on both parties' rows (P4). The rules stay presentation-neutral: "the provider's list of app connections". |
| CR-L8 | §20.1.3 (handler declarations, amending intents §5) | A local client declares session kinds in its local manifest without `route`. Such a handler is never a handoff target or chooser candidate (§5.4 handoff target, §20.1.5). |
| CR-L9 | §20.11 "Marking" | Providers MUST NOT offer the standing mark to a local client whose recorded origin is a web origin (LC-9). |
| CR-L10 | §19.2 decisions | Add an SG row referencing LC-11 and LC-12, so that the pairing representation choice is recorded with the signaling decisions. |

### 8.2 Other documents

| ID | Document | Change |
| --- | --- | --- |
| CR-A1 | device-login.md, auth.md, linked-approval.md, mcp-service.md | Move and split per §1.3 (the device-login supersession note is already corrected). Remove linked approval §14's "Coordinator" row item for the device-login note, which the move retires. |
| CR-A2 | protocol §1 | Application identifiers are HTTPS URLs, **or** RFC 9278 JWK thumbprint URIs for local clients under `local-clients.v1`. |
| CR-A3 | device-authorization §3 | Add a third eligible class: local clients under `local-clients.v1` (proof at request, local manifest, unverified labelling). |
| CR-A4 | auth "Application authorization" | Loopback HTTP redirects are allowed outside development only for local clients under `local-clients.v1` and §2.3 rule 7. |
| CR-A5 | runtime profile "Client ID metadata documents" | Leave the metadata syntax unchanged (HTTPS, public host). Add a pointer that local clients use `local-clients.v1` instead, never a `localhost` metadata URL. |
| CR-A6 | linked approval §5.2, §6.1(5), §8, §15 Q3 | Local clients become eligible for the `app` kind with their labels (Q3's "operator-reviewed only" stays for metadata-document clients). Rename the kinds to session handoff and app sign-in with a code (§1.3). Point "Connected apps" to the §3.2 layout. |
| CR-A7 | protocol §2 feature table | Add `local-clients.v1` (no members in v1). |

## 9. Open owner questions

1. **Pairing representation.** Should a pairing be an RPC (preferences-assignable) resource? *Recommended: no.* Keep the per-edge owner record with P1–P4 (§4.2). Use contributed resources when a daemon exposes methods.
2. **Where headless and local clients are listed.** *Recommended:* in Connected apps, grouped by device group, with a cross-link from Devices. This changes signaling §14.1 (CR-L7).
3. **Idle limit for local clients.** *Recommended:* 30 days (configurable up to 90), against 180 days for other app grants. The owner may choose "until revoked" at approval.
4. **Vendor publisher claims (I2).** *Recommended:* defer. When added, show them as an unverified claim and use them only as a provider policy input.

Reviewer fields record actual outcomes when available. No approval is fabricated, and these questions do not block the reversible phases in §6.
