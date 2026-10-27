# Clean app removal, force removal and subject deletion — design note

Status: **provisional design, 2026-10-22, revision 3.** Revision 3 answers the two open questions of Review round 1 as **Provisional (coordinator), not signed off by the user** (the user delegated them): an organization's clean removal starts after a 24 h notified delay to admins (AU-13, §7.3), and consent pages for an app with a pending removal show "You asked to remove <app>" with ⟦Remove now⟧ (AU-14, §6.1). Implementation proceeds on them, and they stay revisable. Current local status (2026-10-24): AU-S1–AU-S7 and AU-14 have local implementations, including routes, console controls, producer summaries and reminder attempts; organization clean removal remains refused pending AU-13. No production or external delivery verification is implied. Revision 2 was documentation only. Revision 2 applies the user's decisions of 2026-10-22 (§1a, UD-1…UD-3) and the confident fixes of [Review round 1](#review-round-1) (RR1-…); the review's open items remain open. Human sign-off: reviewer ___ / date ___ / outcome ___. The coordinator records the decision in [DEVLOG](../../DEVLOG.md).

Normative draft: [app removal](../spec/app-removal.md) (proposed amendment, unsigned). This note holds the user's direction, rationale, rejected alternatives, the 3sln.me features, the threat model, slices, tests and open questions.

## 1. User direction

> "We should give the user the option to remove/delete/deintegrate an app cleanly, which redirects to the apps own cleanup/uninstall UI, which can let the user keep the app data, delete it, archive it, whatever. The user can also just force delete/remove the app, which just immediately revokes its credentials and doesn't clean up."

> "When the user's account on the provider is deleted, we can signal any installed apps so they can clean up too."

## 1a. User decisions (2026-10-22)

Relayed by the coordinator; recorded here as the user's direction. DEVLOG sign-off is the coordinator's.

| ID | Decision |
| --- | --- |
| UD-1 | **No hard deadline and no auto-revoke.** "we shouldn't give the app a hard deadline, just let the user know if the app hasn't completed by the deadline, and ask if they want to force remove. Until then the app operates normally." The declared cleanup time is a reminder point. When it passes, the owner is notified (activity centre and console) and offered force removal. Until the app completes or the owner forces removal, the app operates normally: no freeze on new grants, no deadline-bounded credentials, no deadline-as-disconnected check. Supersedes revision 1's AU-6 and AU-7 and answers open questions 1 and 2. |
| UD-2 | **Settings kept.** The app's saved settings stay after removal, with delete offered in "What's left". Answers open question 3. |
| UD-3 | **`subject-deleted` is not sent to apps already removed.** Answers open question 4. |

Related decisions already recorded: Parlay is a regular app that stores data in the user's object-storage resource, and must purge its own hot state on the standard signal (DEVLOG 2026-10-22, R1-M12 gap). Disconnect, severance and revocation are always available regardless of flags ([feature flags](feature-flags.md)).

## 2. Decisions

| ID | Decision | Where |
| --- | --- | --- |
| AU-1 | **Two modes, one commit.** Force and clean removal end in the same revocation commit. Clean removal only adds a pending period before it, which the owner can end with force removal at any moment. | spec §1, §4, §5 |
| AU-2 | **"Everything" is defined by authority, not by data.** The commit revokes every credential and authority of the `client_id` for the entity (connection, grants, sessions, codes, entries, brokered credentials both ways, slots, contributions, delegations, bus subscriptions, notification rights, member-context tokens). It deletes no owner data. | spec §4.1–§4.2 |
| AU-3 | **A `removal` member in `bindle_integration`**, `{uri, cleanup_seconds?, back_channel?}`, on the `client_id` origin and path prefix. Public apps may carry a minimal `bindle_integration` for it. No declaration: confirmation plus force. | spec §3 |
| AU-4 | **Not an intent kind.** Intent links (DEVLOG 2026-10-22: `bintent`, user-chosen handlers, first-use consent) are app-agnostic and user-routed. Removal targets one known app, is provider-originated and must be signed by the provider. Reusing intent machinery would bring handler choice and consent steps that mean nothing here. See §4. | §4 |
| AU-5 | **A provider-signed, single-use, 5-minute removal request** (`typ` `bindle-removal+jwt`, `aud` = `client_id`, `sub`, `jti` nonce, `removal` id, optional connection and generation, `cleanup_by`, `return_uri`, and `actor` for organization entities). It carries no authority. | spec §6.2 |
| AU-6 | **Pending changes no authority (UD-1).** While removal is pending the app operates normally. There is no `removing` connection state. Consent pages for the app say a removal is pending. *Supersedes revision 1's time bound and expansion freeze.* | spec §6.4; §5.2 |
| AU-7 | **Reminder, not auto-revoke (UD-1).** At `cleanup_by` the owner is notified and force removal becomes the primary action. 3sln.me: reminder at the app's `cleanup_seconds` (default 15 minutes, at most 24 hours), repeated once after 24 hours and once after 7 days; after that the pending row stays visible with no further notifications. *Supersedes revision 1's auto-revoke.* | spec §6.7; §5.3 |
| AU-8 | **Two completion channels.** A front-channel redirect (every app) and a back-channel POST with an RFC 7523 assertion (confidential apps). The first conclusion wins. The result summary is always shown as the app's claim. Only the owner can cancel. | spec §6.5–§6.9 |
| AU-9 | **`subject-deleted` is a distinct revocation-class SET**, enqueued in the deletion's severance commit after `connection-revoked` and dispatched no earlier than `access_ends_by`, so apps learn of deletion only once every credential is dead. Sent to connections live when account-level severance began, including those severed by an earlier account suspension or closure, never to removed apps (UD-3). Unknown subjects get 202 with no fetch. Best-effort on the app side and disclosed as such. | spec §8 |
| AU-10 | **Suppressions survive removal.** They are keyed by entity and app site (registrable domain) already (`suppression.mjs` `appSite`). A reinstalled app cannot re-ask what was blocked. | spec §9.5 |
| AU-11 | **3sln.me shows what remains** through a per-producer write summary on issuer-hosted storage (aggregates by prefix, not per-object rows), plus the app's own result, settings values (kept, UD-2) and bus records, and says plainly what it cannot see. | §6.3 |
| AU-13 | **Organization clean removal starts after a 24 h notified delay** to every admin, during which any admin may cancel or force it. No second-admin shortcut, and the delay applies to a sole admin too. Force removal is never delayed. Provisional (coordinator), not signed off by the user. | §7.3; spec §9.6 |
| AU-14 | **Consent pages during a pending removal** show "You asked to remove <app>" with ⟦Remove now⟧ beside the approval. Provisional (coordinator), not signed off by the user. | §6.1; spec §6.4 |
| AU-12 | **Deleted identities answer like unknown ones on every public surface** (uniform 404 for lookups, uniform invalid-credential refusals for links); `410` only on the owner's own authenticated surfaces. | spec §8.5; §7.5 |

## 3. What exists today

| Piece | Today | Gap for removal |
| --- | --- | --- |
| `DELETE /api/apps/:id` → `appDisconnect` → `AppConnections.disconnect` (`packages/apps/connections.mjs`) | Sets `disconnected`, increments the generation, vacates slots, emits `connection-revoked` (terminal), writes a delegation cascade row. Reason `uninstalled`. | Grants, app sessions and pending entries are separate calls (`/api/grants/:id`, `/api/app-sessions`, `/api/delegations/revoke`). The console composes them (`apps/web/src/bl/access.mjs`). No single atomic "remove everything" operation. Must be verified per §4.1 row in slice AU-S3. |
| `connectionsSeverAccount` (`packages/runtime/account/connections.mjs`) | Account-wide severance for suspension, recovery, deletion (E2). Suspension severs to `disconnected` too: lifecycle freeze (`lifecycle-runner.mjs:125`) and admin closure (`identity/admin.mjs:278`) run it *before* E2. | No `subject-deleted` row. Because earlier suspensions already disconnected everything, "connections not disconnected at E2" would be empty for inactivity purges and admin closures (RR1-H1). |
| Integration events (`packages/runtime/integration-events.mjs`) | `connection-revoked`, `credential-revoked`, `connection-resumed`, `resource-detached`, `preferences-updated`, `bus-advanced`; revocation types are always delivered; 72 h window. `severAll` already writes `reason:'account-deleted'` into the outbox row (`apps/connections.mjs` `#severAllTx`), but the wire projection (`FIELDS`, line 48) keeps only `floor` and `terminal`. | No `subject-deleted`. Pending-row coalescing (lines 90–92) must not drop or merge it. Delivery to a disconnected connection must stay possible for it (it uses the snapshot endpoint, as revocation does today). |
| Account deletion E2–E4 ([account deletion](account-deletion-export.md#23-execution-order-and-crash-safety)) | E2 severs, E4 drains outboxes up to 72 h. §2.4 says integrations get severance "with `reason:'account-deleted'`", but the SET wire has no reason member. | `subject-deleted` closes that gap without adding a reason to `connection-revoked`. |
| Suppressions (`packages/federation/suppression.mjs`) | Keyed by entity and app principal. | None: survive by construction. Confirm the access view stays reachable after removal. |
| Storage | No per-object producer attribution. The contract has no `list`. | Remaining-data view needs a ledger (§6.3). |
| Parlay/Parlay | Marks its authorization inactive on `connection-revoked`, keeps the MailboxObject. | Must purge on `subject-deleted` (§7.4). |

## 4. Why a manifest member and not an intent kind

The intent-links design is in progress by another agent and was not available when this note was written. From the recorded direction (`bintent=<base64 JSON>`, manifest-declared handlers, the user choosing among handlers, first-use consent, public intent kinds), an intent is "do X with this; let the user pick who". Removal differs on every axis:

| Property | Intent link | Removal |
| --- | --- | --- |
| Target | Any handler the user picks | Exactly the app being removed |
| Originator | Any page, untrusted | The provider, signed |
| Consent | First use, once or always | The owner's removal action is the consent |
| Payload trust | Untrusted input | Verified JWS, audience-bound |

**Recommendation:** a dedicated `removal` member. If intent links later define a generic signed-request envelope, the removal request can adopt its encoding without changing semantics. Open item for reconciliation once the intent-links note lands; nothing here depends on it.

## 5. Protocol rationale

### 5.1 The flow

```
Owner          Provider (3sln.me)                    App (removal.uri)
  │ Remove… ▸ Clean │                                      │
  │────────────────▶│ commit: removal{pending, cleanup_by}
  │◀── 302/nav ─────│ ?removal_request=<JWS, 5 min, jti>   │
  │──────────────────────────────────────────────────────▶│ validate (§6.3), scrub URL,
  │                 │                                      │ ensure own session for sub
  │   choices: keep / delete / archive / export / …        │
  │                 │◀── RPC with existing tokens ─────────│ cleanup (app operates normally)
  │◀──────── nav to return_uri?removal&outcome&result ─────│
  │────────────────▶│ conclude once → revocation commit    │
  │                 │──── connection-revoked (terminal) ──▶│ (events_endpoint, if any)
  │  "Tasks removed. Tasks says: …"                         │
```

Abandonment: if the tab closes, a confidential app may still complete by back channel. Otherwise the removal stays pending; at `cleanup_by` the owner is reminded and offered force removal (UD-1). Nothing concludes it automatically except account deletion.

### 5.2 Narrowing: considered and rejected

Revision 1 rejected narrowing to read and delete methods (it breaks archive and export, and contracts do not uniformly mark delete versus write) and rejected a special cleanup token in the navigation (RFC 9700 discourages credentials in front-channel URLs). It chose "keep grants, freeze expansion, bound credentials by the deadline". **UD-1 supersedes that choice:** the app keeps operating normally, with no freeze and no bound. Review round 1 proposed stopping new inflow (slot dispatch, provider consumers, delegations) during the window (RR1-H2); under UD-1 that is withdrawn too, and the residual is recorded in §8.

### 5.3 Deadline: auto-revoke versus "offer force"

Revision 1 chose auto-revoke. **UD-1 chose "offer force"**: the declared time is a reminder. The trade-off the user accepted: a stalling app keeps full access for as long as the owner does not act. That is no worse than before the owner asked for removal, and force removal ends it at any moment. What the provider owes the owner instead is visibility: an unmistakable pending state, a reminder, and force removal as the primary action after it (spec §5, §6.7).

3sln.me values: reminder at `cleanup_seconds` (default 15 minutes, maximum 24 hours), repeated after 24 hours and after 7 days, then no more notifications while the pending row stays; reissue limit 5 per day per removal; result size 2 KiB.

### 5.4 Why the return is unsigned for public apps

The return can only conclude a removal the owner already started, and concluding only performs the revocation the owner asked for. A forged return can at worst cut the app's cleanup short, which under UD-1 may interrupt a long-running cleanup the owner is waiting for; returns are therefore bound to the starting browser, and an unbound return asks the owner before committing (spec §6.5, RR1-M3). It cannot start, cancel or redirect anything. The result text is displayed as the app's claim in all cases. Confidential apps get an authenticated back channel for the case where the browser is gone.

### 5.5 Subject deletion: after revocation, not before

Sending before revocation would let an app do one last sweep with live credentials, for example copying data out of hosted storage before the wipe. Sending after costs nothing, because the signal only asks the app to delete what it already holds. So the `subject-deleted` row is written in the E2 severance transaction, behind the `connection-revoked` row for the same connection, and E4 drains both. Brokered tokens at third-party integrations stay valid up to `access_ends_by` (commit + 360 s), so dispatch waits until then (RR1-M1). E4 already blocks the wipe until outboxes drain or 72 hours pass (`account-deletion.mjs` `drainOutboxes`), so the rows survive by construction. Prior art: the OpenID RISC profile defines an `account-purged` event with the same meaning. Bindle defines its own identifier because its SETs must carry `connection`, `generation` and `seq` and follow the integrations §6.1 verification order.

Reconciliation with [account deletion](account-deletion-export.md): E2 already severs and E4 already drains for up to 72 hours. Changes: E2's sever transaction adds `subject-deleted` rows; E4's drain includes them; the tombstone `counts` record undelivered ones; §2.4's "`reason:'account-deleted'`" becomes "`connection-revoked` plus `subject-deleted`". E4's 72-hour limit equals the integrations §6.4 minimum, so no change in duration.

## 6. 3sln.me features (not spec)

### 6.1 Connections console: "Remove…"

The app view ([consent experience §7.1](consent-experience.md#71-what-tasks-can-do-apps--tasks)) replaces ⟦Disconnect Tasks⟧ with ⟦Remove Tasks…⟧, which opens a provider-rendered dialog (`frame-ancestors 'none'`, delay-to-arm on the commit buttons):

```
Remove Tasks (tasks.example)

◉ Let Tasks clean up first                      (recommended)
  You'll go to tasks.example, where Tasks lets you choose what happens to
  its data: keep it, delete it, archive it, or other options it offers.
  Tasks keeps all its access and keeps working normally until it finishes.
  If it hasn't finished by 14:45, we'll remind you and you can remove it
  right away.

○ Remove now
  Tasks loses all access immediately and gets no chance to clean up.
  Anything Tasks saved in your storage stays there. Tasks may keep data
  on its own servers.

This also affects:
  • Messaging: Tasks is your messaging app. Messaging stops until you pick another.
  • Notes uses Tasks as its classifier. Notes will need setup again.

                                   ⟦Cancel⟧   ⟦Continue to tasks.example⟧ / ⟦Remove now⟧
```

- With no `removal` declaration, the first option is absent and the dialog says "Tasks doesn't offer a cleanup step."
- With `manifest-invalid`, the first option is absent and the dialog says why ("Tasks's identity changed and hasn't been reviewed").
- From an owner-chosen `suspended`: "Tasks is paused. To clean up, it gets all its access back until it finishes or you remove it now." From a security suspension, the first option is absent (RR1-M5).
- For an organization's app, starting cleanup follows the organization's critical-action rule (§7.3).
- Sibling clients on the same registrable domain are offered as a checkbox: "Also remove Tasks for iOS". Each is a separate removal record.

**Pending removal (UI state, UD-1).** While a removal is open, Tasks stays in the connected list, still working normally, with a "Removal pending" badge:

- before 14:45: "Removal pending · Tasks is cleaning up" with ⟦Open Tasks cleanup again⟧, ⟦Remove now⟧ and ⟦Keep Tasks⟧;
- after 14:45 (reminded): "Tasks hasn't finished cleaning up" with ⟦Remove now⟧ as the primary button, then ⟦Open Tasks cleanup again⟧ and ⟦Keep Tasks⟧. The same banner heads the app view and the activity entry;
- `in-progress` reported: "Tasks says it is still cleaning up" with the app's message as its claim, and the same controls.

Consent and grant-more pages for Tasks during a pending removal carry "You asked to remove Tasks" with ⟦Remove now⟧ beside the approval (RR1-H2; AU-14, Provisional (coordinator), not signed off by the user). For an organization's app the line reads "An admin asked to remove ERP" and names them; ⟦Remove now⟧ appears only to members who may remove it. The pending state ends only by completion, force, cancel or account deletion.

On return:

```
Tasks has been removed
All of Tasks's access has ended.            (brokered: "…ends by 14:52 at the latest")

Tasks says:                                  [the app's claim, with its origin]
  Messages — kept in your storage
  Drafts — deleted on tasks.example
  "Your messages stay in your storage. Reconnect any time."

⟦See what's left⟧   ⟦Done⟧
```

`canceled` shows "You stopped removal on tasks.example. Keep Tasks connected?" with ⟦Keep Tasks⟧ and ⟦Remove anyway⟧. `failed` shows the app's message with ⟦Try cleanup again⟧ and ⟦Remove now⟧.

### 6.2 Activity entries

| Event | Entry |
| --- | --- |
| Start (clean) | "Removing Tasks: waiting for Tasks to finish cleanup. Tasks keeps working until then." |
| Completed | "Tasks removed after cleanup" with the result |
| Reminder (at `cleanup_by`, +24 h, +7 days) | "Tasks hasn't finished cleaning up. It still has all its access." ⟦Remove now⟧ ⟦Wait⟧. Also a notification on the owner's channels. |
| Forced | "Tasks removed without cleanup" |
| Unacknowledged revocation after 72 h | "tasks.example didn't confirm that it stopped. Its access ended on our side at 14:45." |

Organization removals notify every admin and record the acting member in the hash-chained audit.

### 6.3 What's left

A per-app page reachable after removal while anything remains:

| Section | Source | Action |
| --- | --- | --- |
| Files Tasks saved | New **producer summary** (RR1-M7): for storage the issuer gateway writes (hosted R2, and connectors such as Google Drive or Dropbox proxied by the gateway), one aggregate row per (resource, producer site, top-level key prefix) holding `{count, bytes, first_at, last_at}`. No object keys or file names are stored. | ⟦Delete these files⟧: the provider lists the prefix with the storage adapter's internal `list` (hosted R2, Drive, Dropbox and OneDrive adapters have one; the app-facing contract does not), shows a count, and deletes on confirmation. Files under the prefix that other producers wrote are shown and excluded unless the owner includes them. |
| Settings saved for Tasks | Preference values of fragments on Tasks's host that no remaining app or feature reads. Kept after removal (UD-2). | ⟦Delete settings⟧ |
| Bus posts by Tasks | Bus records with Tasks as producer | Purge (events §8) |
| Contributed resources | `withdrawn` contributions | Remove |
| Blocked requests | Suppressions | ⟦Allow asking again⟧ |
| What Tasks reported | The stored result | — |
| Elsewhere | Brokered storage hosted by other integrations; Tasks's own servers | Text only: "Tasks may have stored data at storage.example or on its own servers. Manage it there." Link to the client's `policy_uri` when present. |

The summary counts only writes made after it ships, and only through the issuer gateway. The page says so ("Files saved before 1 Dec 2026 aren't listed"), and counts are labelled approximate because later deletes by other producers are not attributed.

*Cost and privacy (RR1-M7).* Per-object rows would add a durable account-store write to every object put, including connector writes that today never touch the account store, and would create a new record of file names per app. The summary instead keeps an in-memory delta per (resource, producer, prefix) in the account object and flushes it at most once a minute or at 64 writes, in the same transaction as other account bookkeeping when one is open; a crash loses at most that delta, which is acceptable for an approximate view. Rows are bounded at 64 prefixes per (resource, producer), with an "other" bucket beyond that. Rows are owner data: included in the account export, deleted with the account, and deleted when the owner dismisses the page or the resource is removed. The privacy policy must list them with "apps you connected" (§10).

### 6.4 Account deletion screen

Before the deletion confirmation, list connected apps. Apps declaring `removal` get ⟦Clean up first⟧, which runs a clean removal and returns to the deletion flow. The deletion itself never redirects.

## 7. Interactions

### 7.1 Slots

The commit vacates through the existing `#vacateConnection` path, which already emits `occupant-removed` and `slot-changed` and cascades delegation rows. No automatic replacement (extensions §5.1). The dialog lists affected consumers using the existing slot consumer list. Integrations whose required consumer slot empties drop to `configuring`, already modelled.

### 7.2 Brokered credentials and buses

Unchanged severance. The commit composes "Revoke a consumer" for every brokered grant the app holds at other integrations and "Detach a resource" for every brokered record it hosts. Bus subscriptions are deleted in the same commit (events §8).

### 7.3 Organizations

Who may remove an organization's app: members with owner-interface authority under 3sln.me policy, that is `admin` ([organizations design §12b](organizations-design.md#12b-3slnme-grant-management-policy-app-feature-not-spec)). Removal is a non-GM change, so it needs no consent or elevation.

- **Force removal** deletes nothing, so any admin may do it at once. Every admin is notified.
- **Clean removal** lets one admin choose, at the app, to delete organization data with the app's organization-wide credentials. 3sln.me treats starting it as a critical action under ORG-D10: it starts **after a 24-hour notified delay** to every admin (AU-13, Provisional (coordinator), not signed off by the user; implementation proceeds on it, and it stays revisable). During the delay the removal is open but the app is not yet sent the removal request; any admin may cancel it, or force it. There is no second-admin shortcut, and a sole admin waits too, because the delay is what gives the owner and every admin a chance to notice a compromised account. After the delay the starting admin is notified to open the app's cleanup page. Any admin may force or cancel an open removal (RR1-H3). The dialog warns: "Choices you make on erp.example affect Acme's data."
- The removal request names the starting admin in `bindle.actor`. The app must require a member-context session for exactly that member, so a request URL leaked to another member cannot open the destructive page under their session (spec §6.3 step 7).

Members' data held in the organization's resources stays the organization's.

A member's account deletion ends the membership, which sends `member-removed` to organization integrations holding member context. It never sends `subject-deleted` for the organization. Deleting the organization entity sends `subject-deleted` to the organization's connections once organization deletion exists.

### 7.4 Parlay (acceptance criteria)

Parlay keeps hot state in its per-user MailboxObject: metadata, receipts, replay frontiers, outbox and obligations, peer sets, Views and rules, the encrypted delegate key, and up to 64 MiB of bodies while storage is unavailable ([messaging app](messaging-app.md)). Before `PARLAY_ENABLED`:

1. **Subject deleted.** On a verified `subject-deleted` SET, Parlay deletes that user's MailboxObject state (`deleteAll`), cancels its alarms and drops pending obligations without sending. Engine test: after the event, the MailboxObject holds no keys for the subject within one alarm cycle.
2. **Idempotent and silent.** A redelivered SET is answered 202 with no work. A SET for an unknown subject is answered 202 with no fetch, in the same response class.
3. **No storage writes.** Parlay never tries to delete objects under `parlay/v1/` after revocation. Hosted storage is deleted by the provider; external storage stays the user's.
4. **Clean removal page.** Parlay declares `removal`, with options "Keep my archive in my storage" (default), "Delete Parlay's files from my storage" (deletes the `parlay/v1/` prefix it indexed), and "Download an export". Then it purges its MailboxObject and returns `completed` with a result.
5. **Force removal.** On `connection-revoked` with `terminal: true`, Parlay stops processing and purges MailboxObject state for generations below the floor within 30 days, unless a reconnect with a higher generation arrives first.

### 7.5 Identity portability

The [identity portability](../spec/identity-portability.md) draft appeared while this note was being written (read, not edited). It says that after the redirect period the source "treats the identity exactly as a deleted identity", with the uniform 404 of organizations §3a.2. Two consequences, both reflected in the spec:

- A transfer-out, the end of its redirect period and later cleanup at the source MUST NOT emit `subject-deleted` (spec §8.2, amendment AR-9 for the portability author).
- There is no pull form of the signal (spec §8.5). An earlier draft of this note proposed a 410 `account_deleted` answer on the subject URL. That was dropped: it would contradict the uniform 404 and would make apps purge identities that only moved.

Apps key users by origin principal (portability §8.1), so a `subject-deleted` from the destination after a later deletion purges the right account.

If the source's post-redirect cleanup reuses the deletion executor (`purgeBatch`), it must pass a severance reason the `subject-deleted` hook skips (AR-9). Today `lifecycle-storage.mjs:103` maps every non-inactive purge to `'deleted'`.

### 7.5a What deleted identities answer: 404, not 410 (RR1-R1)

[Account deletion §2.4](account-deletion-export.md#24-others-contact-links-and-delivered-messages) said deleted accounts answer `410 account_deleted` to contact links and that handle resolution shows `status:'deleted'`. Organizations §3a.2 and identity portability §10 use a uniform 404. **Rule:** every surface reachable without the owner's own session answers for a deleted identity exactly as for an unknown one (uniform 404 for directory, identity-document, contact-link, delivery and delegation-status lookups). `410` stays only on owner-authenticated surfaces. The 404 applies to *target* lookups. Credential surfaces keep their protocol refusal (below).

*Why.* Privacy: a distinguishable answer lets anyone holding a handle or link confirm that a specific person deleted their account, and lets scrapers sweep the never-reassigned handle space for lifecycle state. Correctness: after a move's redirect period the source answers for the moved identity as for a deleted one, so a `410` would tell apps and peers "deleted" about people who only moved, and invite wrongful purges. Usability for apps is preserved where it matters: connected apps get `subject-deleted`, and everyone else only loses something they could not use anyway, since names are never reassigned and old links can never reach a new person.

*U404 implementation (2026-10-22).* The workstream's explicit uniform-404 instruction supersedes the older `401 link_invalid`/`unauthorized` and unknown-delegation `revoked` exceptions. Public boundaries now conceal lifecycle/deletion faults, including a signed delivery fenced after credential verification. Owner/account-internal paths retain their lifecycle faults. Authorization-request admission also checks the account engine's lifecycle gate rather than trusting the directory's `active` state alone. The route inventory, protocol implications, local test scope and unsigned review fields are in [the U404 record](../release/uniform-unknown-review.md). Existing identity-independent protocol acknowledgements and already-open streams are distinguished there. No production release or provider-conformance approval is implied.

*Boundary: targets answer 404, credentials answer their protocol refusal (2026-10-22, provisional, unsigned).* A request has two parts. One is the credential it presents: an app bearer or DPoP token, a refresh token or authorization code, an object capability URL, an embed credential or session, an MCP token, a prepared postback capability, or a brokering client assertion. The other is the target it names: a handle, a contact link, a subject in the path, or the identity in an authorization request. The credential is checked first and refused with the standard protocol answer: `401` with `invalid_token`/`unauthorized` plus `WWW-Authenticate` where the protocol defines it, `400 invalid_grant` at token endpoints, `401 invalid_client` and `200 {active:false}` at introspection. That answer is the same whether the credential is malformed, expired, revoked, or valid but issued for an account that has since been deleted, is being deleted, or is suspended or moved. It never becomes `404` or `410`. Only after that does an unknown or lifecycle-faulted *target* get the uniform 404. This boundary reveals nothing new. A credential's owner is the party that received it, so refusing it as invalid tells the holder only that it no longer works. Turning credential failures into 404 would break RFC 6749/6750/7662/9449 clients (refresh, re-authorization and DPoP nonce handling all depend on `401`/`400`), and it would answer an invalid token as if the endpoint did not exist. Signed contact links and contact-delivery tokens are the exception that proves the rule: the link itself names the target identity, so a refused link is the same target lookup as an unknown identity and answers 404 (`contactUnknown` in `packages/runtime/public-unknown.mjs`). Serializers use `lifecycleUnknown` to map a credential subject's lifecycle fault to the invalid-credential answer, and `lookupUnknown` only on target lookups.

### 7.6 Reinstall

While a removal is open the app's logins are ordinary (UD-1); only a second connection for the same client is refused, as always. After the commit: a new generation, fresh consent, suppressions kept, leftover settings and files usable again only through new grants. Parlay's archive root pointer survives in the owner's preference values, so a reinstall can find the archive once storage access is granted again.

## 8. Threat model

| Threat | Mitigation | Residual |
| --- | --- | --- |
| App stalls to keep credentials | UD-1: no deadline. Reminder at `cleanup_by` (repeated twice), force removal always available and primary after the reminder, persistent "Removal pending" row | Full access for as long as the owner does not act. Accepted by the user: no worse than before removal was requested |
| App uses the pending period to grab more (new grants, new inflow such as incoming mail through an occupied slot, acting as the owner through delegations) | UD-1 keeps it operating normally. Consent pages show the pending removal beside ⟦Remove now⟧ (RR1-H2) | Everything the app could do before; the owner may approve new grants while removal is pending |
| Owner believes the app is already gone | Copy says the app "keeps working normally until it finishes"; badge and reminders | Owners who ignore the badge |
| App deletes data the user wanted kept | Spec obligations: explicit choice, preserving default, no deletion on load. The provider discloses that choices happen at the app | Not enforceable; a malicious app could delete with or without removal |
| Forged or replayed removal request | Provider signature, `aud`, `typ`, 5-minute `exp`, `jti`; app lookup before fetch | A browser-only app may not detect replay within 5 minutes; harmless, since the request authorizes nothing |
| Leaked request URL (history, logs) | `no-referrer`, immediate URL scrub, short lifetime | Holder still needs the victim's app session to act |
| CSRF to start or cancel removal | Owner-interface POST with the console's CSRF protections; start and cancel only from provider pages | — |
| Forged return | Unguessable removal id; return bound to the starting browser by a `__Host-` cookie; an unbound return asks the owner before committing (RR1-M3) | The app itself can always end its own cleanup and write its own claim |
| Leaked request opened by another organization member | `bindle.actor`; app requires a member-context session for exactly that member (RR1-H3) | Apps that skip the check |
| Clickjacking | `frame-ancestors 'none'` and delay-to-arm on provider pages; apps MUST send `frame-ancestors 'none'` (RR1-L2) | Non-conforming apps |
| Open redirect | Destination is the pinned `removal.uri`; the return redirects only to console paths; apps check `return_uri` equals the issuer's declared `return_uri` | — |
| Domain takeover of the app | Clean removal refused in `manifest-invalid`; staged key or `back_channel` changes | — |
| Back-channel flooding or probing | Local client lookup first, pinned keys, uniform 202, per-client and per-source limits | — |
| `subject-deleted` probing or leakage | Payload is `sub` plus opaque connection (per app, so it adds no cross-app correlation beyond `sub`, which every connected app already holds); sent only to apps connected when account-level severance began, never to removed apps (UD-3) or `manifest-invalid` ones; unknown subjects get 202 with no fetch; dispatched after `access_ends_by` | Each connected app learns that this user was deleted, which public lookups (uniform 404) do not reveal. This is the point of the signal and is disclosed |
| Wrongful purge after transfer | Never sent on transfer or at the end of a redirect period (AR-9); no pull form, because a post-redirect moved identity looks deleted to public lookups | Depends on portability implementing AR-9 |
| App ignores `subject-deleted` | Disclosed as best-effort; credentials already dead | Data the app holds survives |
| App cannot match `subject-deleted` because it dropped the connection on terminal revocation | Receivers resolve by (`iss`, `sub`) and keep that mapping 30 days (spec §8.3, RR1-M6) | Apps that do not |

## 9. Implementation slices (non-overlapping ownership)

All slices run `npm test`. UI slices add DOM and browser verification. Owners are roles; the coordinator assigns them after sign-off.

**Local implementation status, 2026-10-22 (AU workstream; unsigned).** AU-S1–AU-S5 now have wire codecs,
engine Actions/Queries, the transactional revocation and durable federation cascade, owner/front/back-channel
API routes, purpose-separated signing and durable assertion replay protection, and subject-deletion enqueue/delivery.
The account alarm records the three reminder notices without changing authority. Parlay's AU-S9 obligations 1–5
have local purge/cleanup operations and a removal page; archive delete/export choices require configured live-grant
service ports and are hidden otherwise. No external cleanup service or production conformance is claimed.

**Scalability follow-up, 2026-10-23 (provisional).** Hosted-record removal deletes the resource index by the same SHA-256 `(connection, resource)` key used by registration. The commit traverses the bounded account record collection once to detach hosted records and consumer assignments; it does not traverse the resource index for each hosted record. The generation fence, severance rows and atomic delegation revocation remain in the same transaction. `tests/engine-app-removal-commit.test.mjs` meters record reads at 10/64/256 records and asserts zero resource-index list calls.

**AU-2 follow-up, 2026-10-22 (unsigned):** AU-S7 now has ngin console intents and dodo views for clean navigation,
force removal, pending/reissue/cancel controls, unbound-return confirmation, attributed result claims and What's left.
Human returns hand off to the console; authenticated JSON returns preserve terminal summaries. Recent terminal
results (including back-channel completions) can be reopened. Console projections remove revoked connections and
role occupants only through the removal's generation, preserving reinstalled generations. Return parameters are scrubbed after a recognized result.
AU-14 disclosures and Remove now controls exist on legacy and entry consent pages; pending entry consent bypasses
client-side prior-approval/identity-only shortcuts. A server-completed entry still has no consent page to render.
Settings remain intact by default. The owner settings page offers revision-checked deletion through an engine Action;
it refuses deletion while any active consumer remains, rather than silently deleting another app's shared values.

**Wargame fixes, 2026-10-23 (unsigned; values Provisional (coordinator), not signed off by the user).**
- *Stale removals (F5).* `AppConnections.disconnect` and `#severAllTx` conclude the connection's open removal and
  delete its `app-removal/open/` index row in the same commit (`state: forced`, `outcome: disconnected`), mirroring
  the account-deletion hook. Force refuses `connection_stale` when the connection was disconnected or reinstalled
  since the removal started (it still follows a suspend/resume generation forward). The reminder tick skips records
  under the same rule (connection missing, disconnected or reinstalled since start), so a generation bump while
  connected keeps reminding, and rewrites only records whose reminder count advanced.
  Starting from `suspended` refuses `clean_removal_unavailable` when the resume severs instead (capability fence
  mismatch); the severance is re-derived on the next check, so nothing is recorded.
- *Back channel (F2).* The per-source limit stays before any lookup. The failure budget (30 failures per 60 s,
  keyed by a pseudonym of the removal id and client id, so one owner's removal cannot spend another's) is charged only
  when a locally matched open removal fails verification, and is peeked before verifying; an unverified `iss` alone
  never spends it. No shared per-client backstop: it would reopen cross-owner starvation. `FixedWindowGuard.consume`
  gains `peek`.
- *Cascade drain (F4).* Each `app-removal/cascade/` row keeps `attempts`, `next_attempt_at` and `last_error`; a failing
  row backs off (1 min doubling, capped at 6 h) and never blocks later rows. After 8 failures the row is marked `stuck`
  and one `operator-alert` (`kind: app-removal`, `reason: cascade-stuck`) goes to the lifecycle log; stuck rows keep
  retrying at the cap. The account alarm re-arms at the earliest `next_attempt_at` instead of every 60 s, and not at
  all while no revocation port is configured (rows wait for the next owner operation).
- *Bounds.* Concluded removal records and their notices are pruned 90 days after conclusion, keeping at most 100
  concluded records per account (at most 50 deletions per start or tick).
The three durable reminder rows have console presentation and one best-effort attempt each through the configured
push notice port, with reserved/accepted/failed/unavailable/unknown evidence, never a delivery claim. The original slice added no email template or activity-centre item; the AU-S6 follow-up below adds those presentations. A crash after reservation leaves
unknown evidence; the subsequent scheduled reminders and pending console row remain available.
**AU-S6 follow-up, 2026-10-24 (provisional, unsigned).** Hosted objects and writable gateway-managed Google Drive objects now carry producer connection/generation metadata in their existing object records. The remaining-data Engine query derives bounded prefix aggregates (64 prefixes plus other), with bounded pages and no separate file-name ledger or additional per-object write. This replaces the proposed periodic counter flush for adapters that already maintain durable object indexes. Owner keep, export-first and version-conditional resumable deletion actions are exposed through thin owner routes and the English/Spanish console. Google Drive deletion uses its existing retained-version policy, not a promise of immediate physical erasure. Older unattributed data, other providers and app-held copies remain outside coverage. Account exports include aggregate producer summaries. Email and activity-centre reminders now supplement best-effort push; evidence records attempts, never delivery. Production gates remain unchanged. Reviewer: ___ Date: ___ Outcome: ___

**AU-S6 review follow-ups, 2026-10-24 (provisional, unsigned).**
- *Deviation from RR1-M7's privacy intent.* Each attributed object record keeps a `producer` marker (last app writer: connection, generation, top-level folder) and a `createdBy` marker (creating app: connection, generation), instead of RR1-M7's keyless per-prefix counters. The marker lives in the object's existing record and is not copied into the SQL catalog (`hosted_catalog`), owner object pages, read results or `drive/retained/` rows; deletion does not need it there. It lasts while the object record exists, including after a Drive disconnect. Recorded as a provisional deviation in DEVLOG.
- *§6.3 row deletion.* There are no separate summary rows to delete on dismissal or resource removal: summaries are computed on request. Stripping markers when the owner dismisses the page is **not implemented** (recorded deviation). Markers go with the object, with the account, or with an owner overwrite (which drops `producer` and keeps `createdBy`). They also go through the lineage sweep below.
- *Retention after pruning (re-review).* Pruning a concluded (forced or completed) removal record writes a lineage row (`storage/producer-lineage/<removal>`: connection, generation, client, state). What's left therefore stays reachable under the same removal id, and the removal list shows it as `pruned`. An alarm-driven sweep, one bounded batch per alarm, strips markers that are covered only by pruned lineages, not by a retained removal record or an active keep. It writes only to objects whose markers change. When a pass completes, it deletes each swept lineage, together with that removal's keep and deletion rows, unless an active keep refers to it. In that case the lineage is kept and marked swept until the owner chooses again.
- *Keep rows (re-review).* A keep must name a current storage binding or a resource present among the removal's attributed rows. At most 128 keep rows per removal; there is no connection-wide cap. Superseded keep rows and finished or stopped deletion jobs are deleted when their removal's lineage is swept.
- *Write fencing.* Hosted and Drive commits re-check the write condition and the writing app connection's status and generation inside the commit transaction, so an in-flight write from before a removal or reinstall cannot land afterwards. A completed deletion pass is not terminal; a later Delete starts a new pass.
- *Default deletion scope.* Delete removes files the removed app created and last wrote. Files it last changed but did not create, and files kept by an earlier keep choice, are skipped and counted unless the owner explicitly opts in. Kept counts are split into created and changed; the kept opt-in carries `includeChanged` only when the owner chooses the combined action.
- *Keep.* Keep choices are stored apart from deletion jobs (`storage/producer-keep/`), stop an unfinished deletion of the same scope, and protect the kept generations from a later removal of a reinstall of the same app until the owner chooses again. Both are exported with the removal history.
- *Coverage.* Bindle and MCP writes are attributed; browser automation writes are not. Storage that is disconnected or needs reconnection is shown as not deletable here.
Validation is recorded with the AU-2 handoff; the prior pass's counts below are historical, not follow-up results.
The clean-removal flag does not retain enrollment: pending records, reminders and reversal operations explicitly
ignore it, including an env kill. Organization entities are refused; the tested policy hook describes the 24 h delay.
Local validation: core 2,605 passed; Worker 80 passed; UI-state 292 passed; DOM smoke passed; asset build and
Worker dry run passed; full e2e 214 passed with 4 WebKit skips; Parlay removal page Chromium/Firefox 2 passed.
Focused coverage includes wire/route admission, durable nonce replay, commit rollback, flags-off revocation,
removal/completion/force/reconnect/deletion schedules and Parlay terminal-purge/reconnect schedules. Initial gate
failures from an incomplete concurrent asset snapshot, an in-flight Parlay provider/binding edit and a concurrent
identity-file syntax edit were resolved or rerun; no portability source was edited by this workstream.
These are implementation notes, not reviewer or user sign-off. Reviewer ___ / date ___ / outcome ___.


| Slice | Scope | Files (new unless noted) | Depends on |
| --- | --- | --- | --- |
| AU-S1 | Pure functions: `removal` member validation, request claim build and verify (including `actor`), return and result parsing, back-channel assertion check | `packages/federation/removal.mjs`, `tests/app-removal-wire.test.mjs`; one call site in `packages/federation/integrations.mjs` `validateIntegrationManifest`. **Conflict:** the intents work adds an `intents` member at the same call site and shares the public-client minimal `bindle_integration` rule (AR-1, AR-10). One owner (the integrations owner) lands both member hooks; AU-S1 supplies only `removal.mjs` | — |
| AU-S2 | Engine domain: removal records, state machine, reminder tick (no connection state, no live-check hook, UD-1), browser binding for returns | `packages/app/domains/app-removal.mjs`, `packages/runtime/account/app-removal.mjs`, `tests/engine-app-removal.test.mjs`. No change to `packages/apps/connections.mjs` beyond the resume-on-start call | AU-S1 |
| AU-S3 | The revocation commit: one engine operation composing every spec §4.1 row, including the parts now behind `/api/grants`, `/api/app-sessions` and `/api/delegations/revoke`; cascade rows for other stores | `packages/runtime/app-removal-commit.mjs`, `tests/engine-app-removal-commit.test.mjs` | AU-S2 |
| AU-S4 | Routes: start, reissue, return, back channel, cancel, force; signing with the X5 signer under its own `kid` | `packages/runtime/routes/app-removal.mjs`; JWKS entry in `packages/federation/signing.mjs` (signing owner). **Conflict:** portability adds attestation keys and may touch the same key registry; the signing owner sequences both `kid` additions | AU-S2, AU-S3 |
| AU-S5 | `subject-deleted`: event type exempt from coalescing, revocation-class delivery to disconnected connections, dispatch not before `access_ends_by`, enqueue at E2 for `deleted` (covering connections already severed by account suspension or closure, which needs a severance reason on tombstones), skip for a portability reason, E4 count | `packages/runtime/integration-events.mjs` (type table, class, coalescing exemption), `packages/apps/connections.mjs` (`#severAllTx` tombstone reason only), `packages/runtime/account/connections.mjs` (sever hook only), `packages/runtime/lifecycle-storage.mjs` (E4 count only), `tests/subject-deleted.test.mjs`. **Conflict:** portability's source cleanup may reuse `purgeBatch`; agree the `moved` reason with its author before either lands (AR-9) | — |
| AU-S6 | Producer summary (aggregates) and the "What's left" query and actions | `packages/storage/producer-summary.mjs`, a write hook in the hosted and gateway adapters, export inclusion, `tests/engine-producer-summary.test.mjs` | AU-S2 |
| AU-S7 | Console UX: Remove dialog, open-removal row, return page, What's left, activity entries | `apps/web/src/bl/app-removal.mjs`, `apps/web/src/ui/connections/removal*.mjs`, `tests/browser/app-removal.*` | AU-S4, AU-S6 |
| AU-S8 | Fixture app and conformance: an app with a removal page, both channels, stalling and malicious modes | `tests/fixtures/removal-app.mjs`, `tests/app-removal-conformance.test.mjs` | AU-S4 |
| AU-S9 | Parlay purge handler and removal page (§7.4) | Owned by the messaging-app agent, in Parlay's package | AU-S5, AU-S8 |
| AU-S10 | Privacy and deletion-doc wording (§10) | `docs/legal/privacy.md`, `docs/architecture/account-deletion-export.md` §2.4 (coordinator or legal owner) | — |

AU-S1 and AU-S5 can start at once. AU-S5 does not depend on clean removal.

### 9.1 Flags

Force removal is not flagged: disconnect, severance and revocation are always available. Proposed `packages/flags/registry.mjs` rows, both off by default:

```js
['APP_CLEAN_REMOVAL_ENABLED','a','G A S P C',{risk:'crit',stateful:true,requires:['INTEGRATIONS_ENABLED'],envParse:'boolean'}],
['SUBJECT_DELETED_EVENTS_ENABLED','a','G',{risk:'crit',requires:['INTEGRATIONS_ENABLED'],envParse:'boolean'}],
```

- `APP_CLEAN_REMOVAL_ENABLED` gates *starting* clean removals and declaring `app-removal.v1` with a `removal`-capable return. Open removals always conclude (complete, force, cancel) and reminders still fire regardless of the flag. Turning it off means new removals are force only.
- `SUBJECT_DELETED_EVENTS_ENABLED` gates declaring `subject-deleted.v1` and enqueuing the event. It is global, because the declaration is per provider. Rows already enqueued are delivered when it turns off.

Gates before production: `realBrowserFlowsPassing`, `federatedOAuthConformanceVerified` and `securityRedTeamFindingsResolved` for clean removal; `termsAndPrivacyApproved` for `subject-deleted` (privacy §8 wording).

## 10. Privacy policy wording (recommendation for docs/legal/privacy.md §8)

Add after "Data kept in connected storage":

> **Apps you connected.** When you remove an app, its access ends. If you let it clean up first, it keeps working normally until it finishes or you remove it immediately, it can offer to keep, delete or archive what it stored, and we show you what it reports. To show you what an app left behind, we keep a summary of how many files each app saved in your 3sln.me storage and under which folders, without file names. When you delete your account, we end every app's access and tell apps that support it that your account is gone, so they can delete what they hold about you. Apps are run by their developers, not by us. We can't check or enforce what they delete, and their own privacy policies cover data they hold. Data an app saved in your 3sln.me storage is deleted with your account. Data in connected storage, such as Google Drive, stays there until you delete it.

The legal owner makes the edit (AU-S10).

## 11. Tests

Engine level first (ngin), on Worker and Node adapters.

**Edge cases.**

- Each spec §4.1 row revoked by one commit, and each §4.2 item untouched.
- Clean removal refused for `manifest-invalid`, a security suspension, without a declaration, with one already open, and with the flag off. Force available in all of these.
- From an owner-chosen `suspended`, start resumes the connection; cancel leaves it resumed and offers to suspend again.
- Pending removal changes nothing: tokens, refresh, grant-more, slot dispatch and delegations behave identically before and after `cleanup_by`, with the tick running, delayed or crashed (UD-1).
- Reminder fires at `cleanup_by`, again at +24 h and +7 days, then never; a missed or duplicated tick never commits; force is primary after the first reminder.
- Reissue keeps `cleanup_by`; reissue after conclusion refused; reissue limit.
- Return for another signed-in account; unknown and concluded ids give the same page; a return without the browser binding asks before committing.
- `in-progress` from a public app keeps the removal open.
- Result over 2 KiB or with control characters discarded, outcome applied.
- `exclusive` slot vacated with no auto-assignment; required consumer integration drops to `configuring`; `ordered` keeps the remaining order.
- Suppressions survive removal and block after reinstall.
- `subject-deleted` not enqueued for suspension, removal, membership end or a portability cleanup; enqueued after `connection-revoked` in the E2 transaction; sent for connections severed earlier by lifecycle freeze or admin closure; not sent to removed apps (UD-3); not dispatched before `access_ends_by`; not coalesced away; survives the wipe; counted when undelivered.
- Organization removal by a non-admin refused; clean start held for the 24 h delay (also for a sole admin), cancellable and forceable by any admin during it; no request issued before the delay ends; `actor` present; every admin notified.
- Producer summary: one flush per minute or 64 writes; bounded prefixes; no object keys stored; included in export; deleted with the account.

**Seeded chaos tests** (a seeded scheduler interleaves engine operations, crashes and clock jumps; each seed is replayable):

| Scenario | Invariant |
| --- | --- |
| Removal commit racing token refresh and brokered minting | Every credential issued after the commit is refused at use; brokered tokens minted before it end by `access_ends_by` |
| Double completion: front and back channel, plus a duplicate front return | Exactly one commit; one conclusion state; later inputs are no-ops |
| Completion racing the reminder and force | Exactly one conclusion; the state matches the first input linearized in the single writer; the reminder never concludes |
| Stalled app (never returns, keeps refreshing) | Credentials keep working (UD-1); reminders fire on schedule; force at any point commits once |
| Crash mid-revocation (between commit and cascade drain, and inside the drain) | After restart, cascades drain idempotently; no live check succeeds in between |
| App down during removal | The request is still issued; the owner can force; the reminder fires |
| Malicious app: forged return for another removal, oversized result, back channel with an old key, redirect to a foreign `return_uri` | No state change beyond its own removal; uniform responses |
| Account deletion during an open removal | The removal concludes `forced`; `subject-deleted` is sent; no redirect |
| Reconnect racing a late terminal `connection-revoked` or `subject-deleted` | The new generation is unaffected by `connection-revoked`. Not applicable to `subject-deleted`, since a deleted subject cannot reconnect |

## 12. Open questions for the user

Questions 1–4 of revision 1 are answered by UD-1 (questions 1 and 2), UD-2 (question 3) and UD-3 (question 4). New questions from Review round 1:

Revision 3: both answered as Provisional (coordinator), not signed off by the user; implementation proceeds on them.

1. ~~**Organization clean-removal gate** (RR1-H3). Second-admin approval or a 24-hour notified delay before an organization's clean removal starts (recommended), or no gate?~~ **A 24 h notified delay to admins** (AU-13, §7.3).
2. ~~**Consent during a pending removal** (RR1-H2). UD-1 lets the app gain new grants while removal is pending. Show "You asked to remove Tasks" with ⟦Remove now⟧ on those consent pages (recommended), or treat them like any other?~~ **Show it** (AU-14, §6.1).

## Review round 1

Independent adversarial review, 2026-10-22, of revision 1 of this note and of the spec draft, checked against `packages/federation/{integrations,brokered,app-sessions,extensions,suppression,service}.mjs`, `packages/apps/connections.mjs`, `packages/runtime/{account-deletion,lifecycle-storage,lifecycle-runner,integration-events}.mjs`, `packages/identity/{delegation,admin}.mjs`, the public routes, and the cited specs. The user's decisions UD-1…UD-3 arrived during the review, and every finding is judged against them. Fixes marked *applied* are in revision 2 of this note and the spec; the rest are open. Reviewer sign-off: reviewer ___ / date ___ / outcome ___.

### High

**RR1-H1. `subject-deleted` would reach nobody for inactivity purges and admin closures.** *Scenario:* an account is frozen for inactivity. `lifecycle-runner.mjs:125` calls `connectionsSeverAccount(…'lifecycle-frozen')`, and `#severAllTx` (`apps/connections.mjs`) sets every connection to `disconnected` with a terminal revocation. Months later the purge reaches E2. Spec §8.2 sent the event only to connections "not `disconnected` at the deletion's severance commit", which is now the empty set. Admin closure does the same at `identity/admin.mjs:278`. Two of the three deletion bases the spec promises would never signal, and Parlay's MailboxObject (R1-M12) would survive. *Fix (applied):* recipients are connections live when account-level severance began, including those the provider severed for account suspension, freeze or closure in the same lifecycle; tombstones record that reason (spec §8.2, AR-2, AU-S5). Removed apps stay excluded (UD-3).

**RR1-H2. The cleanup period let the app take in new data and act as the owner. Re-assessed under UD-1: accepted, with disclosure.** *Scenario (revision 1):* during a 24-hour window Parlay stays the messaging-ingress occupant, so new incoming mail keeps flowing to it. It keeps its delegate key and can author messages as the user, and it keeps posting notifications. None of that is cleanup. Under UD-1 the app now also keeps gaining grants with no end, for as long as the owner does not act. The user chose this explicitly ("Until then the app operates normally"), and the exposure equals what existed before removal was requested. A stopgap considered here (pausing slot dispatch, provider consumers and delegation renewal) is withdrawn as contrary to UD-1. *Fix (applied):* force removal always available and primary after the reminder (spec §5, §6.7); consent and grant-more pages for the app say a removal is pending, with ⟦Remove now⟧ beside the approval (spec §6.4; open question 2); reminders at `cleanup_by`, +24 h and +7 days. *Revision 3:* the consent-page line adopted (Provisional (coordinator), not signed off by the user, AU-14). *Residual:* an owner who ignores the badge leaves the app fully authorized indefinitely.

**RR1-H3. Organization clean removal: one admin can trigger app-side destruction of organization data, and a leaked request opens the destructive page for any member.** *Scenario:* a compromised admin account starts clean removal of the ERP and picks "delete all records" at erp.example, which acts with the ERP's organization-wide credentials. ORG-D10 says critical actions are delayed and notified, but §7.3 treated this as an ordinary non-GM change. Separately, spec §6.3 step 7 asked the app to check the session "is for `sub`", but for an organization `sub` is the organization, so any member with a member-context session at the ERP who obtains the request URL (shared screen, chat paste, history) passes. *Fix (applied in part):* `bindle.actor` in the request; the app requires a member-context session for exactly that member and applies its own authorization (spec §6.2, §6.3, §9.6). Clean start is a provider-policy critical action; 3sln.me proposal is second-admin approval or a 24-hour notified delay (§7.3, AR-11). Force removal stays immediate. *Open:* the gate itself (open question 1). *Revision 3:* a 24 h notified delay to admins (Provisional (coordinator), not signed off by the user, AU-13).

### Medium

**RR1-M1. `subject-deleted` arrived while brokered tokens were still live.** *Scenario:* E2 severs and enqueues the event; E4 dispatches it within seconds. A brokered read token minted a minute earlier is valid for up to 300 s plus leeway at a third-party, read-only hosting integration that does not introspect (integrations §5.3, AMD-C8). The app, now told the user is gone, can do a last read sweep there. Data at external storage is not wiped by deletion anyway, so the harm is limited, but spec §8.2's "cannot act on it with live credentials" was false. *Fix (applied):* do not dispatch before the latest `access_ends_by` (spec §8.2, §5.5).

**RR1-M2. Users stranded mid-export.** *Scenario (revision 1):* the user picks "Download an export" at Parlay; the export streams from storage with Parlay's tokens; the deadline auto-revokes at minute 15 and the export breaks halfway, with "expired" shown. UD-1 removes the deadline, but two paths remained: a public app's `in-progress` was treated as `completed` (immediate revocation), and an app could return `completed` before its reads finished. *Fix (applied):* `in-progress` keeps the removal open for every app; apps must finish dependent reads before `completed` (spec §6.4, §6.5, §6.7); forcing during a pending cleanup discloses that cleanup may be interrupted (spec §7.1).

**RR1-M3. Forged front-channel returns.** *Scenario:* the removal id travels in the readable JWS payload of `removal_request`. Analytics or session-replay scripts on the app's removal page capture the full URL before it is scrubbed. Whoever holds the id can make the owner's browser load `return_uri?removal=…&outcome=completed&result=…` from any page. The GET is top-level, so SameSite=Lax cookies are sent. That commits early and attaches the attacker's text, attributed to the app. Under UD-1 this cuts short a long-running cleanup the owner is waiting for. *Fix (applied):* bind returns to the starting browser with a `__Host-` cookie, and have an unbound return ask the owner before committing (spec §6.5). The app itself can always end its own cleanup; that is inherent.

**RR1-M4. The §4.1 revocation list and `access_ends_by` overclaimed.** *Scenario:* member certificates are issued by members' *home* providers (organizations §5.2) and verified offline, so the organization's provider cannot "revoke" them. Delegation-status answers are cached publicly for 300 s (`delegation.mjs` `statusCacheControl`). *Fix (applied):* the member-context row now says presentations naming the client are refused from the commit; `access_ends_by` includes the status window (spec §4.1, §4.3). Member certificates and organization-context connections now exist locally; this historical review does not establish complete removal support for organizations (AU-13 remains unavailable).

**RR1-M5. Clean removal from `suspended` re-armed the app, now indefinitely.** *Scenario:* the owner, or an operator after a client breach, suspends an app, then picks "clean up first". Revision 1 restored authority for the window; under UD-1 that becomes until completion or force. *Fix (applied):* clean removal is not offered from a security suspension; from an owner suspension, start is a disclosed resume (spec §6.1, §6.9).

**RR1-M6. Receivers that drop the connection on terminal revocation can never match `subject-deleted`.** *Scenario:* the normal order is `connection-revoked` (terminal) then `subject-deleted`. An app that deletes its connection row on the first, but keeps user data keyed by (`iss`, `sub`), sees an unknown connection on the second and, per §8.3, answers 202 without processing. *Fix (applied):* receivers resolve by (`iss`, `sub`) and keep that mapping for 30 days (spec §8.3). Parlay's §7.4 item 5 is consistent with this.

**RR1-M7. The producer ledger cost a write per object and created a file-name log per app.** *Scenario:* every gateway put, including Drive and Dropbox writes that today never touch the account store (`storage/providers.mjs`), would add a durable row `{resource, key, client_id, …}`. That is a new hot-path write serialized in the owner's single writer, and a new record of file names linked to apps, missing from privacy §8 and the export. *Fix (applied):* aggregates per (resource, producer site, top-level prefix), flushed at most once a minute or every 64 writes, bounded, with no keys stored, included in the export and listed in the privacy text. Deletion lists the prefix with the adapters' internal `list` (§6.3, §10, AU-S6).

**RR1-M8. Slice ownership conflicts with the in-flight portability and intents work.** AU-S1 and intents both add a manifest member through `validateIntegrationManifest` and both depend on the public-client minimal `bindle_integration` (AR-1). AU-S4 and portability's attestation keys both touch the signing key registry. AU-S5 and a portability source cleanup that reuses `purgeBatch` (which maps every non-inactive purge to `'deleted'`, `lifecycle-storage.mjs:103`) would emit `subject-deleted` for moved identities. *Fix (applied in the slice table, AR-9, AR-10):* single owners for the shared call sites, and a `moved` severance reason agreed before either lands. *Open:* the coordinator assigns the owners.

**RR1-M9. Deleted accounts: 410 versus 404 (reconciled as RR1-R1, §7.5a).** Account deletion §2.4 promised `410 account_deleted` on links plus a visible `status:'deleted'`; organizations §3a.2 and portability use a uniform 404. *Decision recommended and applied to the text:* a uniform "unknown" answer on every public surface, with 410 only on owner-authenticated surfaces. Privacy against enumeration outweighs app usability here, because connected apps get `subject-deleted` and portability requires it. The code mostly complies already; one possible leak (a signed contact delivery during the deletion fence reaching `lifecycleBlocked`'s 410) is listed in §7.5a for the deletion owner. No code changed.

### Low

- **RR1-L1.** Suppressions are keyed by entity and app *site* (`suppression.mjs` `appSite`), not by app principal or `client_id`. Text fixed (AU-10, spec §9.5). Removing the web client therefore keeps blocks for the iOS sibling too, as intended.
- **RR1-L2.** The app's removal page offers destructive choices; `frame-ancestors 'none'` is now MUST, not SHOULD (spec §6.4, §10.7).
- **RR1-L3.** Apps checked only that `return_uri` was on the `iss` origin; they now compare it to the issuer's declared `return_uri` (spec §6.3 step 6).
- **RR1-L4.** `integration-events.mjs` coalesces pending revocation rows (lines 90–92) and bounds the outbox; `subject-deleted` must be exempt from both or a later revocation could merge it away (AU-S5). The note's claim that the wire has no reason member is correct: `#severAllTx` writes `reason:'account-deleted'` into the row, but `FIELDS` drops it.
- **RR1-L5.** A connection whose domain changed hands, but whose manifest has not been refetched yet, still counts as live, so the new domain holder could learn of the deletion. *Open:* revalidate pinned client metadata before enqueueing, or accept, since `manifest-invalid` connections are already excluded.
- **RR1-L6. Checked, no finding.** Refresh races: every refresh re-checks the live grant, connection and lineage (`app-sessions.mjs` header). Brokered minting runs in the commit's single writer (integrations §7.4). Issuer RPC re-reads the token record and grants (`service.mjs` `tokenRecord`). Introspection results are cached for at most 30 s, and write-capable contracts require live introspection. Request replay in browser-only apps is harmless. E4's `drainOutboxes` holds the wipe until outboxes empty or 72 h pass, so `subject-deleted` rows survive by construction, and redelivery is idempotent at the receiver by `jti`.

