# Signaling establishment modes, intents routing and call-style notifications: design spike

Status: **design spike, 2026-10-27. Documentation only.** Nothing here is implemented, and no specification is edited by this document. Every decision is **provisional (coordinator) and not signed off by the owner**. Identifiers under `https://spec.bindle.example/` and hosts under `.example` are placeholders. Spike sign-off: reviewer ___ / date ___ / outcome ___.

It answers the open spike items of [signaling](../spec/signaling.md) §5.6 and §19.4 (S1, S2 and I3), against **revision 1 as read on 2026-10-27**. Another agent is revising that draft at the same time, so section numbers cited here may shift. The change requests in §1.6 are written against rev 1 for a rev 2.

Inputs: [signaling](../spec/signaling.md), [intents](../spec/intents.md) and its [design](intent-links.md), [notifications](../spec/notifications.md), [activity](../spec/activity.md), the [activity center](activity-center.md), [Bindle Messaging interop](../spec/messaging.md) and its [architecture](messaging-app.md), [device authorization](../spec/device-authorization.md), [device login](../spec/device-login.md), and the owner's direction of 2026-10-27, quoted in the brief.

**Naming.** The brief calls the messaging app "Parlay". [open-items](../release/open-items.md) D2 records the app name as open, and says Parlay and Parlay were rejected over name clashes. Here "Parlay" means "the Parlay messaging app, whatever it ends up being called". The media type and kind identifiers use the current `bindlebox` path segment, so they change with D2.

**Example only.** The bridle fleet (`../bridle`: a desktop daemon tethered to a phone PWA over WebRTC, paired today by trust on first use) is used here only to test the design. Nothing in this spike builds it.

## 0. Summary

1. **One signaling mechanism with explicit establishment bases, not two mechanisms.** The signed session channel (leg certificates, first claim, profiles, silent ends) is the same for every use. What differs is three things: what admits the invite, which endpoints receive it, and who may claim it without a user action. Rev 2 should add two bases next to `self`, `link` and `none`:
   - **`offer`** for invite-style use. The caller's app mints a one-use offer that is bound to the callee's principal, and sends it inside its own app-level invitation (for Parlay, a call-invite message). The callee's app dials back with that offer when the person taps Answer. The offer routes to the app that minted it, and that app may claim without a further user action. The ring travels through messaging, so it tolerates offline devices. Signaling then only connects two parties who have both already acted.
   - **`pairing`** for always-on use. This is an owner record that pre-authorizes one app, or one enrolled headless client, to connect automatically with another of the owner's apps, or with one named peer principal, for one kind. It fills the reserved "relation basis" of signaling §5.2. It replaces open-ended standing acceptance for app endpoints, and it solves I3 for this mode: the owner pairs two `client_id`s explicitly.
2. **Intents route user-initiated handoffs, never incoming events.** "Call this contact" from a contact card or a web page is an intent. An incoming call is not: the message already landed in a specific app, it is time-critical, and no person is on a provider page to choose. Intents routing stays only for unsolicited signaling invites (the `link` and `none` bases).
3. **The intents chooser gets a ranked short list.** Ranking uses only owner-local and provider-observed signals (defaults, past choices, approvals, use from this device, recency, publisher match, review). It shows at most three candidates, with one action to expand to every capable connected app and a second to browse a catalogue. A single candidate gets a confirm page. Nothing about the list ever leaves the provider.
4. **Ringing is a best-effort presentation hint on an activity item, and never a guarantee.** It needs a small Bindle activity amendment, because apps on any provider must be able to request it portably. Delivery policy, the per-device fallback ladder and the platform feature detection belong to 3sln.me. Today the only real "incoming call" notification on the web is an unshipped Chromium/Edge experiment (§3.1), so the ladder's normal outcome is an ordinary or persistent notification.
5. **Parlay's call invite is a Parlay message** with media type `application/vnd.bindle.messaging.call-invite+json`. It carries the media, an expiry, the caller principal (which must equal the envelope author) and per-recipient offers. The proposed Parlay text is in §4.

## 1. Session establishment modes

### 1.1 What every mode shares

Rev 1 already gives one channel: per-session leg keys certified by each side's issuer, signed messages relayed unchanged, an atomic first claim, profiles (`webrtc`, `data`), silent ends before a claim, and no presence oracle (§1.1, §6 to §8, §12.1). None of that depends on why a session exists. The owner's two cases differ only on the three axes below, so they should be modelled as **bases** on one channel:

| Axis | Invite-style (Parlay call) | Always-on (bridle fleet) |
| --- | --- | --- |
| Admission: why the recipient provider lets the invite in | A person on the other side just asked for this exact session | A standing owner decision made in advance |
| Routing: which endpoints receive it | The one app instance that asked | The app that the owner paired |
| Acceptance: who may claim without a user action | The asking side, because its user already acted | Either side, within the pairing |
| Lifetime of the authorization | Minutes, and one use | Until revoked |

### 1.2 Invite-style: a Parlay call

**The problem with a caller-initiated signaling invite.** The obvious design: the caller sends a call-invite message and also opens a signaling invite to the callee. It fails on several points against rev 1:
- **Admission.** The invite needs a basis at the callee's provider: a contact link with signaling configuration (§5.3), or requests (`none`), which are held and never delivered. Messaging contacts in Parlay are an app link type, not the core contact parents that §5.3 configures. So two contacts who already message each other would still need a second, signaling-specific admission.
- **Routing.** For another entity, the invite goes to the owner's intents routing handler for the kind (§5.4 case 3). That may not be the app that showed the message, so the ring and the answer would land in different apps.
- **Timing.** `answer_by` is at most 120 s, and nothing is stored after it. A ring that must reach a phone in Doze, or a person who opens the app 30 s later, is fragile. Messaging already does store-and-forward and expiry.
- **Two rings.** The message and the signaling invite each want to alert the person.

**Recommendation: reverse dial with an offer.** The ring is the message. Signaling starts only when the callee answers, and it runs from callee to caller:

1. **The caller places a call.** The caller's Parlay calls a new signaling method, `offer` (§1.6 CR-1), on its own provider. The provider checks the slot grant, the session handler approval for the call kind and the limits. It then mints one opaque offer per callee principal, each **bound to that principal, the kind and the profile, single use and short-lived**. It stores only hashes. The offer records the minting endpoint and app.
2. **The caller sends the call-invite message.** It is an ordinary Parlay `conversation-record` (`type: "message"`) or `one-off`, with body media type `application/vnd.bindle.messaging.call-invite+json` (§4). The body carries `expiresAt`, the media, the caller principal and the per-recipient offers. Messaging handles admission (the conversation credential, or the contact link and intake), custody and delivery, as for any message.
3. **The callee's Parlay receives the message.** If it has not expired, and the conversation is an accepted one (not a first-contact request, §4.4), Parlay renders an incoming-call card. It asks the callee's 3sln.me provider for a best-effort ring (§3), as an activity item with the ring hint and the same expiry.
4. **The callee taps Answer.** The tap happens in Parlay's own interface, because answering needs `getUserMedia` and a page. The callee's Parlay calls `open` on the callee's own provider with `to` = the caller principal, `kind` = the call kind, `profile: "webrtc"` and `basis: {offer: <token>}`. The callee's SDP offer carries the media the callee chose, a subset of the invite's (for example, audio only). The callee is now the signaling **initiator**.
5. **The caller's provider admits by the offer.** It verifies the offer at §9.2 step 7 (live, unspent, same kind line, admitted version, same profile). At step 8 it spends the offer atomically, and checks that the offer's principal equals the **verified** principal in the callee's leg certificate. It routes the invite to the minting endpoint, or, if that endpoint is gone, to the minting app's other eligible endpoints of the caller's entity, with late delivery. The projection says `basis: "offer"` and `offer_match: true`.
6. **The caller's endpoint claims at once.** No user action is needed, because the caller's user already acted by placing the call (the same reasoning as the glare rule, §8.3). The caller's Parlay also checks that the invite's `context.call` equals its outstanding call. Then the ordinary `webrtc` exchange runs. Each side checks that the peer's leg principal is the expected one: the callee checks that it equals the message's `caller`.

**How the recipient's app gets admitted and claims.** It does not need admission to be reached at all, because the callee is never reached by signaling: it reaches out. Its own provider authorizes it as an initiator (slot grant, kind approval and limits, §5.1). It is admitted at the caller's provider by the offer the caller gave it. "Claiming the session" is done by the caller's endpoint, which is the recipient of the signaling invite. The person who answers is the one who chose to answer.

**Properties:**
- **No presence oracle in either direction.** A callee who does not answer sends nothing; the offer expires. The caller learns that the callee answered only when the callee answered. The caller's endpoint auto-accepts only the one principal it called, for the one kind, before expiry. That reveals nothing the caller did not already disclose by calling.
- **The same app on both legs, by construction.** The offer routes back to the minting app, whatever the caller's intents default is. On the callee side, the app that rendered the message is the app that dials.
- **Cross-app interop.** The callee may use a different Parlay-compatible app. It needs only an approval for the Parlay call kind and the signaling slot.
- **Other devices of the callee.** Every device has the message and may ring. The first device to answer spends the offer. A second device's `open` is admitted nothing and ends silently at `answer_by`. Parlay's occupant, the callee's server-side mailbox shared by all the callee's devices, tells the other devices that the call was answered and retracts the ring item (§3.7). That is app-internal.
- **Missed calls** are a local rendering of an expired invite with no answer. There is no provider list (§3.6 of signaling still holds).
- **Group calls** are a mesh of two-party sessions (§8.6): one offer per callee principal, up to 16 (§4.3). Larger calls are a conferencing service reached with ordinary sessions.

**Where the rev 1 pieces go.** The offer replaces the deferred "callbacks" (one-use, principal-bound contact links, `callback_digest`, §20.3.2). It needs no links re-scope, because it is a signaling record rather than a link type.

### 1.3 Always-on: paired endpoints

Example: a bridle-style fleet. Agent daemons run on several of the owner's machines. A phone PWA opens and wires up to every live daemon, with no prompt each time. All prompts and blockers are then answered from the phone.

What rev 1 offers is close, but not enough:
- Auto-connect needs `parties: self` **and the same `client_id`** on both legs (§5.5). The daemon (a native public client, for example `https://bridle.example/cli`) and the phone PWA (`https://bridle.example/`) are different clients (I3).
- Standing acceptance (§5.5) is open to **any** admitted initiator of the kind. For a pre-authorized peer, that is wider than the owner meant, and it advertises availability to everyone who can reach the entity.
- `endpoints` lists only the calling app's own endpoints (§10.2), so the phone cannot find the daemons.

**Recommendation: a pairing record, owned by the owner.**

| Member | Definition |
| --- | --- |
| `id`, `revision` | Opaque identifier; updates are compare-and-swap, as for other owner signaling settings (§14.1). |
| `kind` | One session kind line, pinned to the version shown at creation. |
| `local` | `{client_id, client_session}`: the app on this entity. `client_session` is `null` (any session of that app), or one client session identifier, which binds a single enrolled headless client (§1.4). |
| `peer` | Either `{self: {client_id, client_session}}` (another app of the same entity), or `{principal: {iss, sub}}` (one peer entity, origin principal). |
| `accept` | `"auto"`. The only value in v1. |
| `label` | Owner-visible plain text, at most 64 characters. |
| `created_via` | `settings`, `device-authorization` or `app-request`. |
| `expires_at` | `null`, or a time the owner chose. |

Rules:
- **Created only by an owner action** on a provider page with the §20.1.4 disclosure obligations (same-origin, CSRF-protected, `frame-ancestors 'none'`, armed after a delay, nothing preselected). The page names both apps by verified origin, the kind and its profiles, and says that these apps will connect automatically, with no prompt, whenever either is running. For a peer pairing, it also says that the peer can tell when this app is running.
- **Both apps need the session handler approval** for the kind. A pairing whose other side is not yet approved is **pending**: it is shown, but admits nothing until the approval exists.
- **Own-entity pairing extends `self`.** With a pairing that covers (initiator client, claiming client, kind):
  - `target` may name an eligible endpoint of the paired app (today it must be the same app);
  - the projection's `auto_connect` is true for the paired app's endpoints;
  - the kind's `parties` may be `self` or `any`.
- **Cross-entity pairing is the relation basis.** Signaling §5.2 reserves "a relation basis". A pairing with `peer.principal` admits an invite whose verified initiator principal equals it, for that kind. The wire is `basis: {"relation": "pairing"}`, with no secret, because the leg certificate already proves who is asking. The lookup is keyed by a hash of (principal, kind line) at step 7. It is confirmed against the verified principal at step 8, and answered with the uniform `202`. Each owner creates their own side, and a session connects only when both sides' records exist: the initiator's provider requires its own pairing, or another basis, before `open` with `relation`.
- **Routing.** To the eligible endpoints of the paired app only (`local.client_id`, narrowed to `local.client_session` when it is set), at most 16, most recently active first. Never the intents routing handler.
- **Acceptance.** The paired app's endpoints MAY claim `accept` with no user action.
- **Discovery, own entity only.** `endpoints({pairing})` also returns the paired app's live endpoints in the owner's own entity: `{endpoint, label, kinds, last_seen, client_id}`. Across entities there is no discovery. The initiator opens to the principal, and the first claim wins (§12.2 unchanged). A fleet that spans entities is out of scope for v1. The connected peer endpoint can relay to its own fleet at app level.
- **Reconnection.**
  - An opening app opens one session per live paired endpoint, with jitter and exponential backoff after failures.
  - Before the 24 h cap (§8.1), an app MAY open a replacement session and switch over. At most two live sessions per (pairing, endpoint pair) at a time.
  - `answer_by` is no obstacle, because a paired daemon is normally listening. If it is not, the invite ends silently, and the app retries on the paired endpoint's next `last_seen` change.
- **Limits.** Pairing invites get their own window per (pairing, endpoint pair). The reference value is 30 per hour. It sits outside every cross-entity window, and own-entity pairing invites also stay outside the cross-entity windows, as `self` does (§13.1). Pairing invites share the pending reserve with `self` and principal-bound invites.
- **Kinds can opt out.** A kind MAY restrict its bases (CR-6). For example, an agent remote-control kind would accept `self` and `pairing` only, so no contact link or request can ever reach a daemon.

**Standing acceptance after pairing.** Keep it only for **provider features and service entities** (§4.2, §4.3), where "any admitted initiator" is the point (a conferencing service, for example). App endpoints that should answer one known peer use a pairing instead. That turns the §5.5 disclosure ("your availability is visible to any admitted initiator") into the much smaller "visible to this peer".

### 1.4 Enrolling a headless daemon

The daemon is a public native client with no browser. It enrolls with [device authorization](../spec/device-authorization.md) (RFC 8628 with mandatory DPoP), which 3sln.me implements locally behind `DEVICE_AUTHORIZATION_ENABLED`. Bridle-style walk-through:

1. **Start.** `bridle tether work` sends `POST https://3sln.example/oauth/device_authorization` with `client_id=https://bridle.example/cli` (a client ID metadata document listing the device grant), a `dpop_jkt`, and `bindle_requests` for the signaling slot fragment with `register`, `listen`, `claim`, `send`, `renew` and relay credentials.
2. **Show.** The terminal shows the `user_code` and `verification_uri`, and MAY show a QR code. By device authorization §10.6, a QR code that prefills the code loses protection against substitution. 3sln.me should therefore ask the owner to type the code, unless its policy decides the approval is happening alongside the device.
3. **Approve.** On the phone, the owner opens the verification page, authenticates freshly (§5.1(2)), enters the code and consents to the fragments. On the same page, 3sln.me offers, as separate, unchecked controls:
   - the **session handler approval** for the kind declared in the client's manifest (signaling §20.1.4 allows this at slot authorization);
   - **"Connect automatically with Bridle on your devices"**: a pairing with `local = {client_id: …/cli, client_session: <this grant's client session>}` and `peer = {self: {client_id: https://bridle.example/}}`. It stays pending until the PWA is connected and approved for the kind.
4. **Run.** The daemon receives DPoP-bound tokens, registers a DPoP-bound endpoint labelled `work-mac`, and long-polls `listen`. It never needs a person again.
5. **Connect.** The phone PWA opens. It calls `endpoints({pairing})`, then `open` with `target` set to each live daemon endpoint. Each daemon claims at once, and the `webrtc` data channel comes up.

**Standing authorization** is the intersection of four things, each checked live:
- the daemon's client session (device authorization §7: no absolute lifetime by default, an idle limit of 180 days recommended, live lineage and grant checks on every refresh and resource request);
- both apps' slot grants and session handler approvals;
- the pairing record;
- the daemon endpoint's registration (30 days after the last `listen`).

**Finding: device-authorization lineage and long-lived daemons.** Device authorization §7 item 4 revokes the client session when the *approving login session* is ended explicitly, including by sign-out. An owner who approves a daemon from the phone browser and later signs out of that browser therefore silently kills every daemon approved from it. That is right for a TV session, but surprising for a fleet. Options: approve daemons only from a long-lived session, and warn at approval; or define an "account-anchored" lineage for device grants that the owner marks as a standing device, revoked by credential removal, recovery, suspension or explicit revocation, but not by sign-out. This is an owner question (§6 Q3), and it needs a device-authorization amendment if accepted.

**Revocation** uses surfaces that already exist:
- **Devices** (device authorization §8) lists the daemon's client session. Revoking it ends its endpoints and its sessions, with control statement `revoked` (signaling §14.2), and drops the pairing member that is bound to that session.
- **Pairings**, a new row in the §14.1 owner-controls table, under app access: remove, change the label, or set an expiry. Removing a pairing ends its live sessions with `revoked`, and pending ones silently.
- Removing either app's approval or slot grant clears its pairings (§20.1.4 "Clearing").

**What changes for bridle-like apps.** The trust-on-first-use pin is replaced by facts the provider verifies: the leg certificate names the owner's own identity and the `client_id` of each side, and the pairing is an owner record that can be listed and revoked. `bridle unpair` maps to removing the pairing. Re-pairing a new phone is an owner action, not "first to connect wins".

### 1.5 Decision: one mechanism, explicit bases

**Provisional answer to S1 and S2: one mechanism with explicit establishment bases.** Splitting into two mechanisms would duplicate the hard part (certificates, claim, relay, privacy) to vary three table cells.

| Basis | Admits | Routes to | Claim without a user action | Owner hook (§11.3) |
| --- | --- | --- | --- | --- |
| `self` | Own entity | Same app, `target`, or the routing handler | Auto-connect: same app and `parties: self`, or a pairing | No |
| `pairing` (own entity: extends `self`; cross-entity: `relation`) | The paired app or principal, for the kind | The paired app's endpoints | Yes, within the pairing | No |
| `offer` | The offer's principal, once, before expiry | The minting endpoint, or else the minting app | Yes, by the minting side | No |
| `link` | A configured contact link | The intents routing handler | No, except standing acceptance (provider features and services only) | Only with an empty routing set |
| `none` | Requests, if enabled | Held | Never | Held |

Consequences:
- **Intents routing shrinks to the `link` and `none` cases.** Session kinds stay intent kinds, because the registry, disclosure, projection and approvals are all reused (SG-2 stands). Only the "which app receives an unsolicited invite" question still uses the routing handler.
- **Most real traffic never enters the owner hook.** Offer and pairing invites always have a routing target. If none of its endpoints is live, the invite stays pending, with late delivery, until `answer_by`, and then ends silently.

### 1.6 Change requests for signaling rev 2

All of these are proposals against rev 1, and all are unsigned.

| CR | Section(s) | Change |
| --- | --- | --- |
| CR-1 | §5.2, §7.2, §10.2, new §5.7 | **Add the `offer` basis.** New write method `offer({endpoint, kind, profile, principals (1 to 16 origin principals), expires_in (10 to 900 s)}) → {offers: [{principal, offer}], expires_at}`. The method is widening: it checks the approval live. Also add `revoke_offer({endpoint, offers?})`, which is narrowing. Wire: `basis: {"offer_digest": <base64url SHA-256 of the token>}`, with the token carried beside the message in the batch, as for links (§9.1). Its step 7 and step 8 checks are as in §1.2 step 5. The offer is stored hashed with its principal, kind line and version, profile, minting endpoint, minting app and expiry. It is never delivered to endpoints, and it is excluded from export as transient. |
| CR-2 | §7.2, §20.3.2 | **Remove `callback_digest`** and the callback design. The offer replaces them, with no dependency on the links re-scope. |
| CR-3 | §5.4 | **Add routing cases.** Case 4: offer → the minting endpoint if it is eligible, else the minting app's eligible endpoints, with the handoff target set to the minting app. Case 5: pairing → the paired app's eligible endpoints, narrowed to `client_session` when it is set. |
| CR-4 | §5.5, §10.3 | **Acceptance.** Add `offer_match` and `paired` to the projection. Either one permits a claim with no user action. Restrict standing acceptance to provider-feature endpoints and service entities. App endpoints use pairings instead. |
| CR-5 | §5.6 (replace), §2, §14.1, §14.2, §12.6 | **The pairing record (§1.3).** Created by owner action only, pending until both approvals exist, revoked by removal, by clearing the approval or grant, or by revoking the bound client session. The relation basis is defined as `{"relation": "pairing"}`. Pairings are exported as owner data. |
| CR-6 | §20.1.1 (`session` member) | **Optional `bases`** on a session kind: a nonempty subset of `self`, `pairing`, `offer`, `link` and `none`. When it is absent, every basis is allowed. Example: agent remote control is `["self", "pairing"]`; a call is `["offer", "pairing", "link"]`. Frozen in the growth table. |
| CR-7 | §10.2 `endpoints` | **A `pairing` argument** returns the paired app's endpoints of the owner's own entity, with `client_id`. Never across entities. |
| CR-8 | §13.1 | **Limits:** a per-(pairing, endpoint pair) window (reference value 30/h), outside the cross-entity windows; offer-basis invites counted per offer (one use), outside the per-recipient and issuer windows; live offers per entity (reference value 64) and offer mints per app (reference value 120/h); offer and pairing invites included in the pending reserve with `self` and principal-bound invites; at most two live sessions per (pairing, endpoint pair). |
| CR-9 | §8.3 | **Glare** also covers two `pairing` invites that cross for the same kind line between the same endpoint pair. |
| CR-10 | §11.3, §11.4 | **The owner hook and handoff** never apply to `offer` or `pairing` invites. |
| CR-11 | §5.5, §19.4 I3 | **I3 for mode (b) is solved by explicit pairing.** Grouping clients by registrable domain stays unneeded for signaling. It remains in intents only for exclusions. |
| CR-12 | §1, §11.3 | **Cross-references:** the call semantics are in Parlay §5.5 (proposed, §4 here), and the ring is in the activity hint (§3). Signaling stays call-free. |
| CR-13 | §19.2, §19.4, §21 | **Decisions and tests.** New SG rows for the bases, the pairing and the offer. Answer S1 and S2. Tests: offer spent exactly once under concurrency; offer with a wrong principal admits nothing, silently, and is not spent; offer routed to the minter despite a different intents default; pairing pending until both approvals exist; revoking a device-auth client session ends paired sessions with `revoked`; relation basis with no pairing record gets the uniform `202`; `bases` enforcement. |

## 2. Intents routing

### 2.1 Where intents fit, and where they don't

| Use | Intents? | Why |
| --- | --- | --- |
| "Message this contact", "Open this conversation", "Add contact" from a link | Yes | A person is handing off data, and chooses which app does it. This is what intents are. |
| "Call this person" from a contact card, a profile page or a "Call me" button on a site | Yes | A `start-call` intent (data: a principal, or a contact link in the fragment) goes to the owner's calling app. That app then sends a call-invite message (§1.2). |
| Joining a meeting from a link on a web page | Yes, as a handoff | The intent opens the owner's app. Admission is whatever the meeting uses: an offer, or a conferencing service. |
| An incoming call surfaced as a notification | **No** | The event already landed in a specific app (the messaging occupant). It is time-critical. No person is on a provider page. A chooser at ring time would be wrong and slow. Use the ring hint (§3) and the offer (§1.2). |
| Always-on wiring between paired apps | **No** | Pre-authorized and automatic. Use a pairing (§1.3). |
| An unsolicited signaling invite through a contact link | Partly | The routing handler (the intents default for the kind) picks the recipient app. A chooser appears only from the owner hook, after the fact (signaling §11.4). |

**Rule of thumb:** intents answer "which of my apps should do this thing I'm starting?". They do not answer "which app should be told about something happening to me?".

### 2.2 A short list instead of every integration

Today the candidates are already filtered to built-ins and connected apps whose manifest declares the kind, minus exclusions (intents §5). The 3sln.me order is "reviewed first, then recently used" ([design](intent-links.md) §6.3). The owner's concern is that this list can still be long, and that its order carries no signal. Proposal for 3sln.me:

**Tiers:**
1. **Default.** A valid default with no widening hands off directly (intents §7.3, unchanged).
2. **Short list.** At most three candidates, ranked as below, with "why suggested" labels.
3. **All capable apps.** One action, "More apps (n)", expands to every candidate, in the same order.
4. **Find an app.** A catalogue of unconnected apps that declare the kind (later; connecting one is an ordinary authorization).

**One candidate:** a confirm page ("Open with *Bridle*?", with **Just once** and **Always**), carrying every §7.1 disclosure, but no list. A reviewed `view` kind with a single candidate is still a page, never zero clicks (review R1-L5).

**Signals.** Each is a fact the provider holds about this owner, or one it verified. **None is taken from a manifest's claims about itself, and none from payment or promotion.**

| Signal | Source | Initial weight |
| --- | --- | --- |
| Chosen for this kind line before ("just once" or "always"), weighted by recency (half-life 30 days, window 90 days) | Owner choice history (new, see §2.4) | 4 |
| Already holds the approvals and grants this kind needs (for a session kind, the session handler approval) | Approval records | 2 |
| Used from this device recently (the app's connection or session was active from this browser in the last 30 days) | Provider-observed sessions, keyed by the provider's own device session | 2 |
| App used in the last 7 days, from any device | Provider-observed connection activity | 1 |
| The kind line's registrable domain equals the handler's verified origin's | Verified hosts | 1 (relevance only; the §7.1 risk raise for self-published kinds still applies, and it never preselects) |
| Reviewed by 3sln.me | Provider review | 1 |
| Acting entity | Member context (design §6.7) | A filter, not a weight |

- **Order:** ties break by the most recent use, then by `client_id`, compared lexically.
- **Fallback:** with no positive score, the order is reviewed first, then recency, as today.
- **Weights:** these are a starting point for a 3sln.me product review, and they are deliberately simple. No learned model, so that every position can be explained.
- **Labels:** "You used this for links like this", "Used on this device", "From the publisher of this link type", "Reviewed by 3sln.me".
- **Preselection:** nothing is preselected without a default (§7.3, unchanged).

**Session kinds.** The chooser opened from a hook entry (signaling §11.4) uses the same ranking, with the "triggered by an incoming request" label and no preselection.

### 2.3 Privacy

- **The requesting party learns nothing.** The minter or link host gets no response; the handoff is a top-level navigation. That already holds (intents §6, §8). Ranking runs only after the viewer is authenticated, on provider pages.
- **Handlers learn only that they were chosen.** No API, event or response reveals the candidate list, its order, the scores, other handlers, exclusions or whether the receiving handler is the default. Ranking signals are never sent to apps.
- **Choice history is owner data.**
  - It records only the kind line, the handler and the time: never intent data, minters or link hosts.
  - It is bounded (at most 256 entries, 90 days).
  - It is listed under "Links and apps", deletable entry by entry or all at once, exported with the account and deleted with it.
  - A setting, "Use my history to suggest apps", turns it off. The default is an owner question (§6 Q5).
- **Device signals stay local to the provider.** They use the provider's own session records, never fingerprinting or client hints sent to apps.
- **No telemetry** of choices beyond the owner's own record (intents §6 "Retention" extended).

### 2.4 Proposed intents amendment outline (AMD-INT-R1, unsigned)

Target: [intents](../spec/intents.md) §7.2, §7.3, §2, §14. The spec states obligations. The weights, labels and tiers above stay 3sln.me policy, as chooser layout already is.

1. **§7.3 Order and short lists.** "A provider MAY present a subset of candidates first, provided that every candidate is reachable with one further viewer action from the same page. Candidate order and any subset MUST be derived only from the viewer's own records and from facts the provider verified (choices, approvals, the provider's own observations of connection use, verified hosts and the provider's own review). They MUST NOT be derived from a manifest's claims about itself or from consideration paid by a handler. Nothing is preselected without a default."
2. **§7.3 Single candidate.** "With exactly one candidate, the provider MAY show a confirmation of that candidate instead of a chooser. It still meets §7.1."
3. **§7.2 "Just once".** Replace "records nothing" with "records no default. A provider MAY keep a bounded choice history (kind line, handler, time) used only for ordering. It is owner data under §7.4's listing, removal, export and deletion rules, and it is never observable by handlers or minters."
4. **New §7.5 Scope of intents.** "Intents route a viewer-initiated handoff. A provider MUST NOT use the intent chooser to decide which application is told about an incoming event addressed to the viewer, such as an incoming invitation. Applications that receive such events already hold them. Signaling session kinds follow [signaling] §5.4 and its bases."
5. **§11 Registered kinds (candidate).** `https://spec.bindle.example/intents/start-call/v1`:
   - `effect: "send"`, `capability: true`;
   - data: `contact` (`contact-link`, `origin`, optional) or `person` (principal, `value`, optional), and `media` (enum `audio`, `video`, or `audio-video`, `value`);
   - no `session` member: it hands off to an app, and it is not itself a session kind.
6. **§14 row.** "AMD-INT-R1, ordering, short lists and scope, proposed by the signaling-modes spike."

## 3. Opportunistic call-style notifications

### 3.1 Platform research

Sources retrieved on 2026-10-27, unless stated. "BCD" is MDN browser-compat-data 8.1.7 (timestamp 2026-10-22).

| Topic | Finding | Source (date) |
| --- | --- | --- |
| `scenario: "incoming-call"` proposal | Microsoft's proposal adds `scenario` (`"default"` or `"incoming-call"`) to `NotificationOptions`. Incoming-call notifications persist until an action is clicked, loop a platform-provided ringtone, may get call-styled buttons and higher priority, and are **limited to installed web apps**. A site that is not installed gets ordinary behaviour, and a platform that lacks the features falls back to `default`. | [MSEdgeExplainers explainer](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Notifications/notifications_actions_customization.md) (living document, read 2026-10-27); [Edge blog, "Request for feedback"](https://blogs.windows.com/msedgedev/2025/02/04/request-for-feedback-incoming-call-notifications-api/) (2025-02-04) |
| Chromium status | "Incoming Call Notifications": **in developer trial, behind a flag**. Developer trial from M135 (desktop). **Origin trial M140 to M146 (desktop)**. No shipping milestone. Spec maturity: "incubation". Owners are at Microsoft. | [Chrome Platform Status 5110990717321216](https://chromestatus.com/feature/5110990717321216) (API read 2026-10-27; record last updated 2025-08-25) |
| Edge origin trial | Installed PWAs; trial expiry **2026-05-19**. Secondary sources say Edge 140+ on Windows only. | [Edge origin trials page](https://developer.microsoft.com/microsoft-edge/origin-trials/trials/699bfcb9-7bf2-414b-8158-af775f52ac03) (read 2026-10-27) |
| Mozilla and WebKit positions | Both "no signal": mozilla/standards-positions#707 and WebKit/standards-positions#89. | Chrome Platform Status record (above) |
| WHATWG Notifications Standard | Last updated **2026-10-19**. `NotificationOptions` is `dir, lang, body, navigate, tag, image, icon, badge, timestamp, renotify, silent, requireInteraction, data, actions`. **No `scenario` and no `vibrate`** in the dictionary. Declarative notifications fetch resources without a service worker. | [notifications.spec.whatwg.org](https://notifications.spec.whatwg.org/) (snapshot 2026-10-19) |
| BCD: is `scenario` shipped? | No `Notification.scenario` entry, which is consistent with no shipping browser. | BCD 8.1.7 |
| `requireInteraction` | Chrome 47, Chrome Android 47, Edge 17. Firefox 117, partial: "only supported on Windows, behind a flag on other operating systems". Safari and iOS: no. | BCD 8.1.7 |
| `actions` (buttons) | Chrome and Chrome Android 53, Edge 18, Firefox 152. Safari and iOS: no. | BCD 8.1.7 |
| `vibrate` | Chromium only (Chrome 53, Edge 79). Not in the living standard. | BCD 8.1.7; WHATWG IDL |
| `renotify` | Chromium only (Chrome 50). | BCD 8.1.7 |
| `silent` | Chrome 43, Firefox 132, Safari 16.6 (macOS); not iOS. | BCD 8.1.7 |
| Push API | W3C Working Draft **2026-10-05**. `userVisibleOnly` is the promise that every push has a user-visible effect. It defines **declarative push messages** (`"web_push": 8030`, with a `notification` object; `mutable` lets a service worker replace it). Revoking a permission deactivates its subscriptions. | [W3C Push API](https://www.w3.org/TR/push-api/) (WD 2026-10-05) |
| Push urgency and expiry | `Urgency` (`very-low` to `high`) and `TTL` are push-service protocol headers, not Push API members. | [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html) §5.2, §5.3 |
| iOS and iPadOS web push | iOS 16.4+: **only web apps added to the Home Screen** (manifest `display` standalone or fullscreen), permission requested from a user gesture, and integration with Focus. | [WebKit blog](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) (2023-02-16); BCD (`showNotification` iOS 16.4, Home Screen note) |
| Safari declarative web push | iOS and iPadOS 18.4, macOS 15.5. **Silent push is prohibited** (`userVisibleOnly` must be true). If the service worker fails to show a replacement, the declared notification is shown instead, which removes the "silent push penalty" of imperative push. BCD: `window.pushManager` Safari 18.4; `Notification.navigate` Safari 18.5 and Firefox 158; Chrome: no. | [WebKit blog, "Meet Declarative Web Push"](https://webkit.org/blog/16535/meet-declarative-web-push/) (2025-03-27); BCD 8.1.7 |

**What this means for each platform (inferred from the table):**
- **Desktop Chrome and Edge:** a persistent notification (`requireInteraction`) with action buttons and a tag. The ringing scenario exists only behind a flag, or in a trial that has ended.
- **Android Chrome:** action buttons and a vibration pattern, with high-urgency push. No ringtone or full-screen call UI is available to the web.
- **Firefox:** buttons (152+). Persistence only on Windows.
- **Safari on macOS:** an ordinary notification. No buttons, no persistence.
- **iOS:** an ordinary notification, and only for a Home Screen web app.

**Not verified in this spike** (treat as assumptions until tested on devices):
- whether any browser ships `scenario: "incoming-call"` by default after the origin trial (the Chromium record was last updated 2025-08-25);
- how Chrome on Android maps `Urgency: high` to FCM priority, and the delivery latency in Doze;
- whether desktop Chrome and Firefox receive push while the browser process is closed (commonly documented as no, unless background mode is on), and how Safari on macOS behaves when closed;
- whether iOS lets a web app's notification use a time-sensitive interruption level, or break through Focus;
- that the web has no access to native call surfaces (CallKit, PushKit VoIP pushes, Android full-screen intents). This is widely documented, but no primary source was fetched here;
- the exact behaviour of a push that only closes a notification in each browser (§3.5 avoids depending on it).

**Conclusion:** a web provider cannot guarantee a ring on any platform today. Even the experimental scenario needs the *showing origin* to be an installed PWA. For the provider path, that means 3sln.me installed as a PWA, not Parlay. The design must treat ringing as an opportunistic upgrade of an ordinary notification.

### 3.2 API shape: a ring hint on an activity item

Parlay already notifies only through core activity (Parlay architecture §14). A call ring is therefore an **activity item with a presentation hint**. It is not a new channel, and it is not a signaling feature.

Proposed activity binding members (activity amendment, §3.8):

```json
{
  "operationId": "…",
  "subject": "Incoming call",
  "content": {"mimeType": "text/plain", "body": "alice@3sln.example is calling"},
  "tags": ["call"],
  "priority": "urgent",
  "collapseKey": "call-6f1d…",
  "expiresAt": "2026-10-27T18:04:30Z",
  "presentation": {"class": "ring", "until": "2026-10-27T18:03:30Z", "media": ["audio", "video"]}
}
```

- **`presentation.class: "ring"`** requests time-limited, call-style presentation. It is advisory, like `priority`: recipient policy MAY ignore it, demote it or present it as an ordinary notice. It never bypasses consent, mutes, the global push pause or budgets. It confers nothing.
- **`until`** is required. It is at most 120 s after admission, and at most `expiresAt`. After `until`, the item MUST NOT be presented as ringing.
- **`expiresAt` and `collapseKey`** are required with a ring hint. `expiresAt` is at most 15 minutes after admission.
- **`media`** is an optional display hint (an audio or video icon or label). It is never trusted as a statement of what will connect.
- **No session data.** The item carries no offer, `sid`, endpoint, caller key or URL to the provider. The provider never learns call semantics beyond "ring until T".
- **The hint is in the signed admission evidence** (activity "Item identity"), like `priority`.
- **The outcome is uniform.** Admission responds the same whether or not anything rang, so an app cannot learn the owner's ring policy, quiet hours or devices (activity "Lifecycle": admission is not delivery).
- **Discovery is provider-level only.** The binding's capability response lists `presentation.ring` when the provider supports the hint at all, so an app can skip it on providers that don't. It never reports per-owner policy.
- **Grant.** Requesting the hint needs its own method grant (`activity.ring`) next to `create`. Without it, the hint is refused as invalid input. It is not silently dropped, so that an app learns its grant is missing, which reveals nothing about the owner.
- **Stopping.**
  - `Replace` with `presentation` absent (for example, subject "Missed call") ends the ring and leaves a normal item.
  - `Retract` ends it and disables it.
  - Expiry ends it.
  - Each of these cancels undispatched ring work (activity "Lifecycle").

**Opening from a ring.** The activity center sends every notification click to a fixed same-origin activity destination, and never to an app URL. For a ring, that adds a hop at the worst moment. Proposal: an item MAY carry `open: {path}`, a path that is validated to lie under the app's verified `client_id` origin and path prefix. After authenticating the exact account (activity center, "Multi-account destinations"), 3sln.me MAY navigate top-level to that path with `#bitem=<item id>`, with no interstitial, for ring items only. The app treats the hint as untrusted, as intents §8 does. Whether to allow this, or to keep the fixed destination plus one "Open in Parlay" control, is an owner question (§6 Q6).

**Notification actions.** At most two: **Open** (the same as a click) and **Dismiss** (a local close). There is no "Answer" or "Decline" that acts without a page:
- answering needs the app's page and `getUserMedia`;
- a declining button that signals the caller would be a presence oracle and a form submission from a notification, which the activity center forbids.

An explicit decline is an app action, taken in the app.

### 3.3 Owner policy and consent

| Control | Default | Notes |
| --- | --- | --- |
| "Allow ringing from this app" (per app connection incarnation) | Off | Offered when the app holds the `activity.ring` grant, and in Connected apps. Needs the app's activity admission and its push opt-in (activity center) as well. Reconnecting resets it. |
| Devices that ring | Every enrolled device that is eligible for this app's push | Uses the activity center's "selected enrolled-device set". |
| Quiet hours | Rings are suppressed | A suppressed ring becomes an ordinary item under the normal rules. Because it expires within minutes, it normally never reaches a digest (the activity center drops expired items). |
| "Rings from this app may sound during quiet hours" | Off | Per app. Still cannot override a mute, the global pause, missing consent or the budgets. Platform Do Not Disturb or Focus always wins. |
| Lock-screen preview | Generic | Generic: title "Incoming call", no app name, caller or count. With preview consent: the app's subject and body, labelled with the app's verified name and origin, and treated as untrusted app text. |
| "Pause all push" | — | Also stops every ring, at once. |

Disclosure at enablement:
- "*Parlay* can ask 3sln.me to show call-style alerts on your devices. They are best effort: some browsers show them as ordinary notifications, and some calls may not alert at all. Don't rely on them for anything urgent."
- Turning ringing on also discloses the class ("Incoming call") on the lock screen.

### 3.4 Delivery ladder and fallback

At final dispatch, after every activity-center eligibility step, 3sln.me sends one high-urgency Web Push per eligible device: `Urgency: high`, with `TTL` = the seconds left until `until`, and nothing sent if fewer than 5 remain. The encrypted payload carries an opaque locator, `class: "ring"`, `until`, and the generic or preview text. The 3sln.me service worker chooses the presentation by **local feature detection**, never by user-agent strings:

1. **Ringing scenario available**, and the 3sln.me web app is installed: `showNotification` with `scenario: "incoming-call"`, `requireInteraction: true`, Open and Dismiss actions, and `tag` = the item locator. Detected by checking whether the `scenario` member is honoured. Today that is only a flag or an expired origin trial (§3.1).
2. **Persistent notification available** (Chromium desktop, Firefox on Windows): `requireInteraction: true`, `renotify: true` with the tag, actions where `Notification.maxActions` > 0, and `vibrate` (a short repeating pattern) where it is supported (Android Chrome).
3. **Basic** (Safari, iOS Home Screen apps, other browsers): an ordinary notification with the same tag. For Safari subscriptions, 3sln.me MAY send a declarative push message (`web_push: 8030`, `mutable: true`), so that a notification still appears if the service worker fails.
4. **No push** (not enrolled, permission denied, browser closed, push service delay): the activity feed only. Parlay rings **in-app** when it is in the foreground, which is the most reliable path, and works without 3sln.me.

A push that arrives after `until` (judged by the service worker against the payload's `until`, allowing 30 s of skew) is shown as an ordinary, silent "Missed call" notice. It is never shown as a ring.

### 3.5 Expiry and cancellation on the device

The web cannot schedule the closing of a notification. So when a ring ends early (cancelled, answered elsewhere, retracted), 3sln.me sends a second push with the **same tag**. That push *replaces* the ring with an ordinary, silent notice ("Call ended" in generic form). It does not try to close the notification without showing one: Safari forbids silent push, and Chromium's handling of a push with no visible effect is not verified (§3.1). Where a page of the 3sln.me origin is open, `getNotifications({tag})` plus `close()` MAY also be used. A ring that simply runs to `until` is left to the platform. Rings carry `requireInteraction` only where the device honours it.

### 3.6 Abuse limits

These are proposed reference values for 3sln.me, for product and security review:
- **Ring starts:** at most 6 per app per hour and 20 per app per day; at most 12 per account per hour. A ring is counted once per logical item, before fan-out to devices, and retries keep its identity.
- **Concurrency:** at most one ringing item per app at a time (a newer one collapses the older one through `collapseKey` or replacement), and at most 3 per account.
- **Over budget:** the ring degrades to an ordinary notification under the ordinary push budget. It is never queued to ring later.
- **The ring lane is separate** from the ordinary push budget, so routine activity cannot starve calls, and calls cannot drain routine budgets. Both count toward the account's aggregate cap.
- **Replacements** that re-add a ring hint to an item that has already rung count as a new ring start. That stops "re-ring by replace" loops.
- **Duration:** `until` is capped at 120 s after admission (§3.2). A longer ring is a new item, and spends budget.
- **App-side duties** for Parlay (§4.4): ring only for accepted conversations and contacts, never for first-contact requests; at most 3 rings per caller per 10 minutes; no ring for an invite that has already expired.

### 3.7 How it ties to Parlay's call invite

1. **The invite arrives.** The callee's Parlay occupant (server side) accepts a call-invite message (§4) into custody.
2. **The ring is requested.** If the invite is still live and passes the §4.4 rules, Parlay submits an activity item using its noninteractive workload authority (activity "Authority and submission"). The item has `presentation.class: "ring"`, `until = min(invite.expiresAt, admission + 120 s)`, `expiresAt` = the invite's expiry, `collapseKey` = derived from the call id, and `open.path` = the call route.
3. **The device rings, best effort** (§3.4). Tapping it opens Parlay's call screen. The person answers there, and Parlay dials back with the offer (§1.2).
4. **The ring ends** when any of these happens:
   - the caller cancels, or the call ends (the caller sends an `edit` with `state: "cancelled"` or `"ended"`, §4.3);
   - one of the callee's devices answers (Parlay's occupant learns this from its own client);
   - the invite expires.

   Parlay then **replaces** the item with "Missed call" (no hint), or retracts it. 3sln.me sends the replacing push (§3.5).
5. **With no ringing at all,** the call still works. The invite shows in Parlay's conversation, with an Answer button until it expires.

### 3.8 Bindle spec item or 3sln.me feature?

**Both, split narrowly:**
- **Bindle (activity amendment AMD-ACT-R1, unsigned):**
  - the `presentation` member, with `class: "ring"`, `until` and `media`;
  - the required `expiresAt` and `collapseKey`, and the caps;
  - the "advisory, never guaranteed, never bypasses policy" language, which mirrors `priority`;
  - its place in the signed evidence;
  - the uniform admission outcome;
  - the `activity.ring` grant;
  - provider-level capability discovery;
  - the optional `open.path`, if the owner accepts it.

  This must be portable, because an app such as Parlay works with every Bindle provider. It replaces nothing in [notifications](../spec/notifications.md). That document is a message-centric 3sln.me implementation draft, already slated for a rewrite (signaling §20.7).
- **3sln.me feature (activity center):**
  - the owner controls in §3.3;
  - the ladder and service-worker detection in §3.4;
  - cancellation by replacement in §3.5;
  - the budgets in §3.6;
  - the lock-screen text.

  None of this is interop.
- **Not in signaling.** The signaling provider still presents nothing (signaling §3.6, §11.3). The ring comes from the app's own activity item, not from a signaling invite.

Activity says that apps "MUST NOT select devices, sounds, lock-screen previews, or policy overrides". The ring hint keeps to that: it asks for a presentation class, and the recipient's policy decides everything else.

## 4. Proposed Parlay addition: the call-invite media type

The text below is written as a proposed new **§5.5** of [Bindle Messaging interop](../spec/messaging.md). It is **not applied to messaging.md**. It depends on signaling rev 2 CR-1 (offers) and CR-6 (`bases`).

> ### 5.5 Structured bodies: call invitations (proposed, unsigned)
>
> A call invitation is an ordinary message whose body has media type `application/vnd.bindle.messaging.call-invite+json`. It travels as a `one-off` or a `conversation-record` of `type: "message"`, under every rule of §5 to §8. It is a request to connect, carried by messaging. The connection itself uses [signaling](signaling.md). Providers attach no meaning to it.
>
> #### 5.5.1 Body
>
> The body is strict I-JSON under §5.1's parsing rules, at most 4 KiB, with exactly these members:
>
> | Member | Definition |
> | --- | --- |
> | `v` | `1` |
> | `call` | Lowercase UUID chosen by the caller. It identifies the call across edits, and it is the session kind's `context.call`. |
> | `state` | `"ringing"` in the original message. An `edit` (§6.3) MAY change it to `"cancelled"` or `"ended"`. Every other value is invalid. |
> | `media` | A nonempty, unique, ascending subset of `["audio", "video"]`: what the caller offers. |
> | `createdAt` | Unix milliseconds. It MUST equal the envelope's `createdAt`. |
> | `expiresAt` | Unix milliseconds, from `createdAt` + 10,000 to `createdAt` + 900,000. Default `createdAt` + 60,000. |
> | `caller` | `{iss, sub}`. It MUST equal the envelope's verified author principal (§3.3). A receiver refuses a body where it does not, with `content_invalid`, after author verification. |
> | `session` | `{kind, profile, offers}`, defined below. |
>
> `session`:
> - `kind`: an artefact reference `{artefact, version, digest}` to a signaling session kind. This profile registers `https://spec.bindle.example/messaging/v1/sessions/call`.
> - `profile`: `"webrtc"`.
> - `offers`: 1 to 16 entries `{principal: {iss, sub}, offer: <signaling offer token>}`, one per invited principal, unique principals, never including `caller`. In a `conversation-record`, every listed principal MUST be a genesis participant.
>
> Unknown members are invalid. An `edit` keeps `v`, `call`, `media`, `createdAt`, `caller` and `session.kind` and `session.profile` unchanged. It MAY set `offers` to an empty array, and only `state` may otherwise change. An edit with any other change is refused (`content_invalid`).
>
> The envelope `subject` MUST be `"Audio call"` or `"Video call"` (localizable by the sender), so that a receiver that does not support this type still shows something meaningful (§5.1, [message content](message-content.md) "Other permitted media types").
>
> #### 5.5.2 The call session kind
>
> `…/parlay/v1/sessions/call` is an intent kind with a `session` member (signaling §20.1):
> - `effect: "join"`, `capability: false`, `max_bytes: 64`;
> - data `{call}` (`uuid`, required, display `presence`);
> - `session` `{"v": 1, "parties": "any", "profiles": {"webrtc": {"media": ["audio", "video"]}}, "bases": ["offer", "pairing", "link"]}`.
>
> An app that renders or places calls MUST hold the owner's session handler approval for this kind.
>
> #### 5.5.3 Handoff to signaling
>
> 1. **Placing.** Before sending, the caller's app obtains one offer per invited principal from its own provider (signaling `offer`), with `expires_in` ≥ the invitation's remaining lifetime, and puts them in `offers`.
> 2. **Answering.** Only after an explicit user action, the callee's app calls signaling `open` with `to` = `caller`, `kind` = `session.kind`, `profile` = `session.profile`, `basis` = the offer listed for its own principal, `context` = `{call}`, and `params.media` a nonempty subset of `media`. It sends nothing if `expiresAt` has passed (judged by its own clock, allowing 30 s of skew) or the latest revision's `state` is not `"ringing"`.
> 3. **Binding.** The callee's app MUST check that the connected peer leg's verified principal equals `caller` before sending media. The caller's app accepts an `offer`-basis invite only when its `context.call` names a call it is still placing, and its verified initiator is a principal it invited.
> 4. **Ending.** The caller's app SHOULD revoke unused offers and send an `edit` with `state: "cancelled"` when it stops ringing before anyone answers, or `"ended"` when the call ends. Receivers present the latest revision. "Missed" is a local presentation of an invitation that expired unanswered.
>
> Offers are principal-bound and single-use. Every participant of a conversation can read every listed offer, but only the named principal can use one.
>
> #### 5.5.4 Receiver rules
>
> A receiver:
> - MUST NOT auto-answer;
> - MUST NOT alert (ring, notify urgently or request a ring presentation) for an invitation that:
>   - arrived through first-contact intake (`one-off` on a link parent, `conversation-init`, bridged intake), or from a conversation the owner has not accepted;
>   - is past `expiresAt`, or whose latest `state` is not `"ringing"`;
>   - comes from an author who has already alerted 3 times in the last 10 minutes;
> - MAY still store and show any of those invitations, inertly, as messages;
> - MUST NOT include offers in notifications, previews, search indexes, logs or exports without capabilities (§6.4 secrecy rules apply to them as capabilities);
> - when it alerts through the owner's provider, does so only through a best-effort activity presentation hint ([activity](activity.md) AMD-ACT-R1), never through a guaranteed channel.
>
> #### 5.5.5 Limits and errors
>
> - Call invitations count as ordinary messages against every §11 limit.
> - A sender SHOULD NOT send a new invitation to the same conversation while one of its own is still `"ringing"`.
> - Invalid bodies are refused with `content_invalid` (§8.3), before custody, and the refusal never depends on the recipient's alert policy.
>
> #### 5.5.6 Conformance additions (§13)
>
> Vectors are needed for:
> - a valid audio and a valid video invitation;
> - a `caller` mismatch;
> - `expiresAt` out of range;
> - an edit that changes `media`;
> - an offer naming a non-participant;
> - an offer listing the caller.

## 5. Provisional decisions (unsigned)

| ID | Decision | Sign-off |
| --- | --- | --- |
| SMS-1 | One signaling mechanism with explicit establishment bases; no second mechanism (§1.5). | Reviewer ___ Date ___ Outcome ___ |
| SMS-2 | Invite-style establishment is a reverse dial using a principal-bound, single-use `offer` carried in an app-level invitation; callbacks and `callback_digest` are withdrawn (§1.2, CR-1, CR-2). | Reviewer ___ Date ___ Outcome ___ |
| SMS-3 | Always-on establishment is an owner `pairing` record (own entity: extends `self`; cross-entity: the relation basis). Standing acceptance is limited to provider features and service entities (§1.3, CR-4, CR-5). | Reviewer ___ Date ___ Outcome ___ |
| SMS-4 | Headless clients enroll through device authorization, with an optional pairing offered on the approval page; pairing members MAY bind one client session (§1.4). | Reviewer ___ Date ___ Outcome ___ |
| SMS-5 | Intents route viewer-initiated handoffs only; incoming events never use the chooser (§2.1, AMD-INT-R1 item 4). | Reviewer ___ Date ___ Outcome ___ |
| SMS-6 | The chooser shows a ranked short list from owner-local and verified signals, with one action to expand, and a confirm page for one candidate (§2.2, AMD-INT-R1 items 1 to 3). | Reviewer ___ Date ___ Outcome ___ |
| SMS-7 | Ringing is an advisory activity presentation hint (Bindle), with delivery policy and fallback in 3sln.me; it is never guaranteed (§3). | Reviewer ___ Date ___ Outcome ___ |
| SMS-8 | Parlay's call invite is a Parlay message with `application/vnd.bindle.messaging.call-invite+json` (§4). | Reviewer ___ Date ___ Outcome ___ |

## 6. Open questions for the owner

1. **Reverse dial (SMS-2).** Is it acceptable that the callee's app initiates the signaling session, so that the caller's app answers automatically for its own outstanding call? The alternative is a caller-initiated invite, which needs signaling-specific admission between contacts and runs into the 120 s window.
2. **Pairing replaces open standing acceptance for apps (SMS-3).** Keep the open form only for provider features and service entities?
3. **Device-grant lineage (§1.4 finding).** Should a device grant that the owner marks as a standing device survive the approving browser's sign-out? Revocation would remain through credentials, recovery, suspension or explicit revocation.
4. **Group calls.** Is up to 16 offers per invitation, as a mesh, enough for Parlay v1? Or should calls larger than about 4 people wait for a conferencing service?
5. **Choice history default (§2.3).** Should "use my history to suggest apps" be on or off by default?
6. **Opening from a ring (§3.2).** Allow `open.path` (direct navigation to the app's call screen after account resolution), or keep the fixed activity destination plus one "Open in Parlay" tap?
7. **App-own push.** Parlay installed as its own PWA could push and ring by itself, outside Bindle. Should the reference app stay "activity only" (architecture §14), or may it also ring by itself when it is installed?

## 7. Recommended path

1. **Record this spike** in DEVLOG as provisional and unsigned (the coordinator's step). Feed CR-1 to CR-13 to the signaling rev 2 author, once rev 1 settles.
2. **Signaling rev 2:** the `offer` basis and the `pairing` record (CR-1 to CR-11), with engine-level tests first. Covered at the ngin engine level: offer spend races; principal mismatch; minter routing against a different intents default; pairing pending and revocation; device-auth revocation cascading into paired sessions; plus a seeded chaos test of concurrent offers, claims and revocations. All behind the existing default-off signaling flags.
3. **Device authorization:** resolve Q3, then add the pairing control to the approval page (provider policy; no protocol change unless the lineage changes).
4. **Parlay §5.5** (§4) and the call session kind, in the protocol package's validation and vectors, behind `PARLAY_ENABLED`.
5. **Activity AMD-ACT-R1**, then the 3sln.me ring policy, ladder and budgets in the activity center. Verify in real browsers on Android Chrome, desktop Chrome or Edge, Firefox, Safari on macOS and an iOS Home Screen app. Test the flagged `scenario` in Chromium only as an experiment. Record what each platform actually did. A populated push key or a screenshot is not delivery evidence.
6. **Intents AMD-INT-R1** and the 3sln.me short-list chooser, with DOM and browser tests for ranking labels, expansion, the single-candidate confirm page and history deletion.
7. **Keep production disabled** under the [security](../spec/security.md) gates throughout. Nothing here changes a gate.

## References

- MicrosoftEdge, "Notifications actions customization / incoming call" explainer: https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/Notifications/notifications_actions_customization.md (read 2026-10-27)
- Microsoft Edge blog, "Request for feedback: Incoming call notifications API" (2025-02-04): https://blogs.windows.com/msedgedev/2025/02/04/request-for-feedback-incoming-call-notifications-api/
- Microsoft Edge origin trial "Incoming Call Notifications" (expiry 2026-05-19): https://developer.microsoft.com/microsoft-edge/origin-trials/trials/699bfcb9-7bf2-414b-8158-af775f52ac03
- Chrome Platform Status, "Incoming Call Notifications" (record updated 2025-08-25; read 2026-10-27): https://chromestatus.com/feature/5110990717321216
- Mozilla standards position request #707: https://github.com/mozilla/standards-positions/issues/707; WebKit standards position request #89: https://github.com/WebKit/standards-positions/issues/89 (status taken from Chrome Platform Status; not opened directly)
- WHATWG Notifications API Standard (last updated 2026-10-19): https://notifications.spec.whatwg.org/
- W3C Push API (Working Draft 2026-10-05): https://www.w3.org/TR/push-api/
- RFC 8030, Generic Event Delivery Using HTTP Push (TTL §5.2, Urgency §5.3): https://www.rfc-editor.org/rfc/rfc8030.html
- WebKit, "Web Push for Web Apps on iOS and iPadOS" (2023-02-16): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, "Meet Declarative Web Push" (2025-03-27): https://webkit.org/blog/16535/meet-declarative-web-push/
- MDN browser-compat-data 8.1.7 (2026-10-22): https://github.com/mdn/browser-compat-data
- RFC 8628 (device authorization grant) and RFC 9449 (DPoP), as cited in [device authorization](../spec/device-authorization.md).
