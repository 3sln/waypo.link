# App removal and subject deletion — normative draft (proposed amendment)

Status: **proposed amendment, unsigned, 2026-10-22, revision 3.** Revision 3 records two answers that are Provisional (coordinator), not signed off by the user: the pending-removal disclosure on consent pages (§6.4) and 3sln.me's 24 h notified delay before an organization's clean removal starts (§9.6). Implementation proceeds on them, and they stay revisable. Revision 2 applies the user's decisions of 2026-10-22 (marked **UD-1…UD-3**: no hard deadline and no auto-revoke; settings kept after removal; `subject-deleted` not sent to apps already removed) and the confident fixes of [Review round 1](../architecture/app-uninstall.md#review-round-1) (marked RR1-…); its open items remain open. The user decisions are recorded here as the user's direction; their DEVLOG sign-off is the coordinator's. Person-account clean removal and force removal, signed requests/results, the revocation commit, producer summaries and cleanup reminders are implemented locally (`packages/app/domains/app-removal.mjs`, `packages/runtime/routes/app-removal.mjs`, `packages/storage/producer-summary.mjs`). New clean removals require `APP_CLEAN_REMOVAL_ENABLED` (default off); existing removals continue when it is off. Organization clean removal remains unavailable (`unsupported_entity`); the provisional 24 h policy in §9.6 is not implemented. Subject-deleted dispatch is separately gated by `SUBJECT_DELETED_EVENTS_ENABLED` (default off). Nothing is production-verified. Rationale, 3sln.me UX, slices and tests: [app uninstall design](../architecture/app-uninstall.md). Human sign-off: reviewer ___ / date ___ / outcome ___. The coordinator records the decision in [DEVLOG](../../DEVLOG.md).

This document extends [integrations](integrations.md) (connections, events, severance), [extensions](extensions.md) (slots), [events](events.md) (buses), [incremental authorization](incremental-authorization.md) (suppression), [auth](auth.md#token-lifetime-and-client-sessions) (client sessions) and [organizations](organizations.md). It defines interoperability rules only: the manifest member, the request and return formats, the revocation guarantee, force-removal semantics and the `subject-deleted` event. Console layout, copy and the remaining-data view are provider choices. Identifiers under `https://spec.bindle.example/` are placeholders. §12 lists the amendments this draft needs in existing documents. It is a separate document, not an appendix to integrations, because it also covers public apps without `bindle_connection` and adds an account-level event.

## 1. Model

**Removal** ends the relationship between one entity and one application, identified by its `client_id`. It always ends in the same **revocation commit** (§4). There are two modes:

| Mode | What happens before the commit | Who starts it |
| --- | --- | --- |
| **Force** | Nothing. The commit runs at once. | The owner; the provider for account deletion (§8) |
| **Clean** | The provider sends the owner to the app's declared removal page with a signed **removal request** (§6.2). The app offers its own choices (keep, delete, archive, export, anything app-defined), cleans up while it keeps operating normally, and returns a **result**. The commit runs when the app completes, or when the owner chooses force removal. At the **cleanup reminder** time the owner is told the app has not finished and is offered force removal (§6.7). | The owner |

Clean removal is a courtesy to the app and the owner. **User decision UD-1 (2026-10-22):** there is no hard deadline and no automatic revocation. In the user's words: "we shouldn't give the app a hard deadline, just let the user know if the app hasn't completed by the deadline, and ask if they want to force remove. Until then the app operates normally." The owner's remedy against a slow or stalling app is force removal (§5), which is available at every moment. Nothing the app does or fails to do can prevent that commit.

A **removal record** is provider state: `{removal, entity, client_id, connection?, mode, state, started_at, cleanup_by, reminded_at?, outcome?, result?, committed_at?, access_ends_by?}`. `removal` is an opaque identifier of at least 128 bits of entropy, unique per issuer. At most one removal record per (entity, `client_id`) is open at a time.

Removal is distinct from:

- **suspension** ([integrations §3.1](integrations.md#31-states)), which keeps configuration and can be resumed;
- **narrowing** a grant, which keeps the connection;
- **subject deletion** (§8), which ends the entity itself.

## 2. Feature declaration

| Feature | Members | Meaning | When absent |
| --- | --- | --- | --- |
| `app-removal.v1` | `jwks_uri` (issuer origin), `return_uri` (issuer origin), optional `completion_endpoint` (issuer origin) | The provider implements §4–§7: force removal with the §4 guarantee, clean removal toward a declared `removal.uri`, and the front-channel return at `return_uri`. `completion_endpoint` is present when it also accepts back-channel completion (§6.6). | Apps cannot expect removal requests. Disconnect follows [integrations §7](integrations.md#7-severance) only. |
| `subject-deleted.v1` | — | The provider sends the `subject-deleted` event (§8) to integrations with an `events_endpoint`. Requires `integrations.v1`. | Apps are not told of deletion. Their credentials still end at severance (§8.5). |

`jwks_uri` holds the keys that sign removal requests. It MAY be the same document as `brokered-resources.v1.jwks_uri`, provided removal keys have their own `kid` values and are used for nothing else (amendment AR-5). A provider MAY declare `subject-deleted.v1` without `app-removal.v1`, and the reverse.

## 3. Manifest member

The `removal` member of `bindle_integration` ([integrations §2.2](integrations.md#22-members)):

```json
"bindle_integration": {
  "v": 1,
  "removal": {
    "uri": "https://inbox.example/bindle/remove",
    "cleanup_seconds": 1800,
    "back_channel": true
  }
}
```

| Member | Meaning |
| --- | --- |
| `uri` | Required. The app's removal page. It obeys the integrations §2.1 path-prefix rule: HTTPS, on the `client_id` origin and path prefix, with no userinfo, query or fragment. It MUST be distinct from every redirect URI, `initiate_login_uri`, `management_url`, `events_endpoint`, `rpc_endpoint` and `discovery_endpoint`. |
| `cleanup_seconds` | Optional. How long the app expects cleanup to take, from the start of removal to the cleanup reminder (§6.7): an integer from 60 to 86,400. Default: provider policy. It sets only when the owner is reminded; it never limits the app's credentials (UD-1). |
| `back_channel` | Optional boolean, default `false`. When `true`, the app may complete by back-channel (§6.6) and may return `outcome=in-progress`. Valid only for a confidential client (integrations §2.1). In a public client's manifest it is treated as `false`. |

A public client MAY carry `bindle_integration` with only `v` and `removal` (amendment AR-1). An invalid `removal` member is treated as absent. Changes to `uri` within the origin and path prefix, and to `cleanup_seconds`, are adopted at the next refetch and audited. Adding or removing `back_channel` is staged for owner review under integrations §2.3. The value pinned at the start of a removal governs that removal.

**No declaration.** When the pinned manifest has no valid `removal`, or the connection cannot use clean removal (§6.1), the provider offers only force removal. It MAY present it as a confirmation followed by force removal. The provider MUST NOT send the owner to any other app URL (such as `management_url`) as a substitute for a removal page.

## 4. The revocation commit and guarantee

### 4.1 What the commit revokes

The revocation commit is one local transaction in the entity's single writer. It covers **every** authority the `client_id` holds for the entity, in every generation and on every device:

| Authority | Effect at the commit |
| --- | --- |
| The connection | `disconnected`, with the generation incremented ([integrations §3.1](integrations.md#31-states)). The record stays as a tombstone. |
| Fragment grants, field and method grants, scoping selections | Revoked. They never revive (protocol §4). |
| Client sessions: refresh-token families, connection-bound refresh tokens, paired component credentials | Revoked ([auth](auth.md#token-lifetime-and-client-sessions)). Issuer-hosted RPC with any outstanding access token fails at its next live check. |
| Outstanding authorization codes, open authorization entries (`login`, `grant-more`, `configure`) and pending device authorizations for the `client_id` and entity | Invalidated. A later exchange fails with `invalid_grant`. |
| Brokered credentials **consumed** by the app | Its grants on brokered resources are revoked, and `credential-revoked` is enqueued to each hosting integration (integrations §7.1, "Revoke a consumer"). |
| Brokered resources **hosted** by the app | Every brokered record of the connection is detached (integrations §7.1, "Detach a resource"): `credential-revoked` for every consumer grant, then `resource-detached`. |
| Slot occupancy | The connection is vacated from every slot (§9.1). |
| Provider consumers of the app's resources | Disabled for those resources (extensions §5.3). |
| Resources the app contributed ([resource contributions](resource-contributions.md)) | `withdrawn`. |
| Key delegations and other provider-certified purposes for the app | Revoked; their status endpoints answer `revoked` (cascade, drained after the commit). Status answers already cached by verifiers stay valid for at most the status window (Parlay §3.4, 300 s), which counts toward `access_ends_by` (§4.3, RR1-M4). |
| Event-bus subscriptions, doorbells and publish or read grants | Deleted ([events §8](events.md#8-revocation-and-lifecycle)). |
| App notification channels and activity posting rights | Disabled. |
| Member context of the app at an organization entity ([organizations §7](organizations.md#7-member-context-for-applications)) | Refused from the commit: the organization's provider rejects every member-certificate presentation naming this `client`. Member certificates are issued by members' home providers, not by this provider, so they are not revoked; they simply stop being accepted here (RR1-M4). |
| Intent handler defaults for the app ([intents §7.3](intents.md#73-choosing-among-handlers-and-changing-defaults)) | Cleared, as intents §7.3 already requires when a handler's connection ends. Exclusions (intents §7.4) are kept, like suppressions (§9.5). |

The commit enqueues, in the same transaction, `connection-revoked` with `terminal: true` and every event listed above. Effects owned by other stores (for example a separate token or delegation shard) are written as durable cascade rows in the same commit and applied afterwards. Until a cascade is applied, the changed generation already makes every live check fail.

### 4.2 What the commit does not touch

The commit deletes no owner data. Specifically it leaves:

- objects the app wrote to the owner's storage resources;
- preference values, including values of fragments the app published;
- records the app published on event buses;
- activity items already delivered;
- audit records;
- incremental-authorization suppressions (§9.5);
- data the app holds in its own infrastructure.

The provider SHOULD show the owner what remains (§7.3). Deleting any of it is a separate owner action.

### 4.3 The guarantee

From the revocation commit, whether or not the app cooperated, completed cleanup or is reachable:

1. the provider issues no credential for that `client_id` and entity;
2. issuer-hosted RPC from the app fails;
3. brokered access ends no later than `access_ends_by` at a conforming integration (integrations §7.3);
4. cached delegation-status answers expire no later than `access_ends_by`.

`access_ends_by` is the later of the integrations §7.3 bound (commit + 360 s) and commit + the delegation status window (300 s) when the app held key delegations (RR1-M4).

The provider records `committed_at` and `access_ends_by` on the removal record and reports them to the owner. The integrations §7.3 limits apply unchanged: no recall of data already returned, and no control over a non-conforming party.

## 5. Force removal

Force removal performs the §4 commit immediately. It needs only the owner's explicit confirmation in the provider's authenticated owner interface, and it MAY run while a clean removal is open, which concludes that removal with `state: forced`. The provider makes no request to the app before the commit. The app learns of it through the ordinary events (§4.1), if it has an `events_endpoint`, or through failing credentials.

Force removal MUST always be available, for every connection state including `manifest-invalid` and `suspended`, and throughout an open clean removal, before and after its cleanup reminder. A provider MUST NOT make force removal conditional on the app's availability or cooperation. While a clean removal is open, the provider MUST show force removal wherever it shows the pending removal, and MUST make it the primary action once the cleanup reminder has fired (UD-1).

## 6. Clean removal

### 6.1 Start

Only the owner starts a clean removal, through the provider's authenticated owner interface, by an explicit action (never on page load or by GET). The provider offers it only when all of these hold:

- the provider declares `app-removal.v1`;
- the pinned manifest has a valid `removal` member;
- the connection is `configuring`, `active`, `degraded` or `suspended`. Not `manifest-invalid`: the app's origin may have changed hands (integrations §2.3), so only force removal is offered. Not a suspension the provider or an operator imposed for a security reason (client breach, compromise, policy): restoring authority there would re-arm the party the suspension stopped (RR1-M5);
- no removal is open for this (entity, `client_id`).

Starting commits, in one transaction, a removal record with `state: pending` and `cleanup_by` = start time + the lesser of `cleanup_seconds` (or the provider default) and the provider maximum. The provider maximum MUST NOT exceed 86,400 seconds. A provider MUST NOT remind before the lesser of `cleanup_seconds` and 600 seconds has passed. The connection keeps its state: there is no separate connection state for a pending removal (UD-1, §6.4).

Starting from an owner-chosen `suspended` resumes the connection under integrations §3.1 in the same transaction, so the app can clean up. Because nothing ends that authority except completion or force removal, the provider MUST disclose before the owner confirms that the app gets its full access back until it finishes or the owner removes it now (RR1-M5).

The provider then navigates the owner's browser top-level to `removal.uri` with the request (§6.2). The page that performs the navigation sends `Referrer-Policy: no-referrer`.

### 6.2 Removal request

```http
GET /bindle/remove?removal_request=eyJ… HTTP/1.1
Host: inbox.example
```

`removal_request` is a JWS (compact serialization):

- header: `alg` `ES256`, `typ` `bindle-removal+jwt`, and a `kid` from `app-removal.v1.jwks_uri`;
- payload:

```json
{"iss":"https://example.org","sub":"https://example.org/entities/e_123",
 "aud":"https://inbox.example/bindle/client.json",
 "iat":1792499700,"exp":1792499940,"jti":"3c9f6a0e9b2d4f17a1c8e5b7d2f04a63",
 "bindle":{"v":1,"purpose":"remove","removal":"rm_7d1e…",
   "connection":"c_5c0f…","generation":3,
   "cleanup_by":1792501500,
   "return_uri":"https://example.org/apps/removal/return"}}
```

| Claim | Meaning |
| --- | --- |
| `aud` | Exactly the app's `client_id`. |
| `sub` | The entity. |
| `exp` − `iat` | At most 300 seconds. |
| `jti` | The single-use nonce: at least 128 bits of entropy, unique per issuer. |
| `bindle.purpose` | `remove`. |
| `bindle.removal` | The removal identifier. |
| `bindle.connection`, `bindle.generation` | Present only when the app received `bindle_connection` at code exchange (integrations §3.3). Public apps never learn a connection identifier here. |
| `bindle.cleanup_by` | Unix seconds. When the provider will remind the owner if the app has not completed (§6.7). Informational: the app's credentials do not change at this time (UD-1). |
| `bindle.return_uri` | Exactly `app-removal.v1.return_uri`. |
| `bindle.actor` | Present only when `sub` is an organization entity: `{"iss","sub"}` of the member who started the removal (§9.6, RR1-H3). Absent otherwise. |

The request carries no data, grants nothing and is not a credential at the provider. Its only meaning is "this entity's owner, at this issuer, asked to remove you, and will return to `return_uri`".

**Reissue.** If the owner's navigation fails, or the request expires before the app accepts it, the owner may ask the provider to open the removal page again. The provider issues a new request with a new `jti` for the same `removal` and the same `cleanup_by`. A reissue never moves the reminder.

### 6.3 App validation

The app MUST perform these checks, in this order, before showing any account-specific content:

1. Parse the JWS without trusting it. Require `alg` `ES256` and `typ` `bindle-removal+jwt`.
2. Look up a local relationship for (`iss`, `sub`), and for (`iss`, `connection`) when `connection` is present. **If none exists, show a neutral page and stop, without any network fetch.** The page is the same as for every failure in steps 3–6, so it reveals neither whether the app knows `sub` nor why validation failed.
3. Verify the signature with a key from `app-removal.v1.jwks_uri` of that issuer's manifest, fetched under the protocol §2 rules, cached for at most one hour, and refetched on an unknown `kid` at most once per minute.
4. Check `aud` equals its own `client_id`, `bindle.purpose` equals `remove`, and `iat`/`exp` with at most 30 seconds of leeway.
5. Check that `jti` has not been accepted before. A server-side app records it until `exp` plus leeway. A browser-only app SHOULD record it in origin storage, and relies on the provider's single conclusion per removal (§6.7) otherwise.
6. Check that `bindle.return_uri` is HTTPS, has the `iss` origin exactly and has no userinfo or fragment, and equals the `return_uri` of that issuer's `app-removal.v1` declaration.
7. Establish that its user session is for `sub` at `iss`. If it is not, run its ordinary authorization (protocol §2), with `subjectConstraint` set to `sub` where `authorization-entry.v1` supports it. During a pending removal this is an ordinary login (§6.4). When `bindle.actor` is present, the app MUST instead require a member-context session (organizations §7) for exactly that actor in `sub`, and MUST apply its own authorization for that member before offering any choice that deletes or alters organization data. A member-context session for any other member gets the neutral page (RR1-H3).

After step 1 the app MUST remove `removal_request` from the address bar and history (a redirect to a clean URL, or `history.replaceState`), and MUST NOT log it or send it in a `Referer`.

### 6.4 While a removal is pending

**User decision UD-1 (2026-10-22).** Until the app completes or the owner forces removal, the app operates normally. A pending removal is a provider record, not a connection state, and it changes no authority:

- credentials are issued, refreshed and checked exactly as before. Nothing expires at `cleanup_by`, and no live check consults the removal record;
- grants, `grant-more`, `configure`, slot dispatch, provider consumers, event delivery, bus access, notifications and key delegations all continue under their ordinary rules. The earlier draft's freeze on expansion and its deadline-bounded tokens are withdrawn;
- consent and grant-more pages the provider shows for this app during a pending removal SHOULD say that a removal is pending, with force removal offered beside the approval (RR1-H2; revision 3, Provisional (coordinator), not signed off by the user). This is disclosure, not a restriction. 3sln.me's wording is "You asked to remove <app>" with ⟦Remove now⟧;
- a new authorization that would create a second connection for the same `client_id` and entity is refused while the removal is open, as at any time a connection exists.

The protocol does not limit what the app reads or does while removal is pending. The owner's remedy is force removal, available at every moment (§5).

**App obligations on its removal page.**

- It MUST NOT delete or alter owner data without an explicit choice the user makes on that page. Loading the page MUST NOT cause deletion.
- It SHOULD default to the choice that preserves data.
- It MUST always offer a control that returns to the provider without further steps, so the owner is never held on the page.
- It MUST NOT frame the provider's pages, and MUST send `frame-ancestors 'none'` (or an equivalent policy) on its removal page, which offers destructive choices (RR1-L2).
- It MAY perform cleanup that writes to the owner's storage within its existing grants, for example writing an archive object.
- It MUST finish every read that an export or archive the user chose depends on before it returns `completed`. After that return its credentials end at once (RR1-M2). Work that needs more time returns `in-progress` instead.

### 6.5 Front-channel return

The app concludes by navigating the browser top-level to `return_uri`:

```http
GET /apps/removal/return?removal=rm_7d1e…&outcome=completed&result=eyJ2IjoxLC… HTTP/1.1
Host: example.org
```

| Parameter | Meaning |
| --- | --- |
| `removal` | Required. The removal identifier from the request. |
| `outcome` | Required. `completed`, `in-progress`, `canceled` or `failed`. |
| `result` | Optional. Base64url (no padding) of the result JSON (§6.8), at most 2,048 bytes before encoding. |

`in-progress` means the user made their choices and the app continues cleanup in the background. The removal stays open and the app keeps operating. A confidential app with `back_channel` completes later by back channel (§6.6). Any other app completes by a later front-channel return when the owner reopens its cleanup page, or the owner forces removal after the reminder. It is never treated as `completed` (RR1-M2).

The provider SHOULD bind each return to the browser that started the removal, for example with a `__Host-` cookie holding a per-removal secret set at start. A return without it shows the owner what the app reported and asks "Finish removing Tasks now?" before committing, so a third party who learned the removal identifier cannot cut an in-progress cleanup short or attach its own result text (RR1-M3).

The provider handles the return only for a signed-in owner session of the removal's entity. Otherwise it shows its sign-in, and after sign-in handles the return for that entity only. It never handles a return for a different account, and it redirects only to its own console paths. Unknown, concluded or mismatched `removal` values all produce the same "nothing to do" page.

### 6.6 Back-channel completion (confidential clients)

When `removal.back_channel` is `true` and the provider declares `completion_endpoint`, the app MAY POST:

```http
POST /bindle/removal/complete HTTP/1.1
Host: example.org
Content-Type: application/x-www-form-urlencoded

client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer&client_assertion=eyJ…&outcome=completed&result=eyJ2Ijox…
```

The client assertion follows [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html), exactly as for change hints (integrations §8): `iss` and `sub` equal the `client_id`, `aud` equals `completion_endpoint`, `exp` − `iat` ≤ 60 seconds, a unique `jti` replay-protected for its lifetime, and `bindle_removal` equal to the removal identifier. `outcome` is `completed` or `failed`. `canceled` and `in-progress` are refused at this endpoint.

The provider looks up the client locally (never fetching metadata for a client with no connection here), verifies the assertion against the pinned keys, and checks that the removal belongs to that client. It answers 202 to every well-formed request, whether or not it was valid or changed anything, and counts requests against per-client and per-source limits.

### 6.7 Provider processing

Each removal concludes exactly once.

| Input | State | Effect |
| --- | --- | --- |
| `completed` (either channel) | `pending` or `in-progress` | Revocation commit. `state: completed`. The result is stored. |
| `in-progress` (front channel) | `pending` | `state: in-progress`. The result, if any, is stored. The provider shows the owner that the app is still working, with "remove now". |
| `failed` (either channel) | `pending` or `in-progress` | The result is stored and the owner informed. The removal stays open. The owner may reissue the request or remove now. |
| `canceled` (front channel only) | `pending` or `in-progress` | No state change. The provider asks the owner whether to keep the app connected. Only the owner's confirmation at the provider cancels (§6.9). |
| Owner chooses "remove now" | open | Force: revocation commit, `state: forced`. |
| `cleanup_by` passes | open | **Reminder, no state change (UD-1).** The provider records `reminded_at`, notifies the owner through its owner notification channels that the app has not finished, and offers force removal there and on the app's entry. |
| Account deletion severance | open | Force, inside the severance commit: `state: forced` (§8.4). |
| Owner disconnects the app outside removal, or an account-level severance | open | Concluded inside the disconnect or severance commit: `state: forced`, `outcome: disconnected`. A later reconnect is a new incarnation; the concluded record can neither block a new removal, remind, nor force it (2026-10-23 wargame F5, Provisional (coordinator), not signed off by the user). |
| Any input | concluded | No state change. A provider MAY store a late result for display, marked as received after removal. |

Conclusion is idempotent: duplicate or concurrent inputs race in the entity's single writer, the first one wins, and the rest are no-ops that return the same view.

**Reminders.** A provider MUST remind the owner at least once after `cleanup_by` passes, and MUST keep the pending removal, with force removal as its primary action, visible on the app's entry until the removal concludes. It MAY repeat reminders at increasing intervals; it SHOULD NOT remind more than a few times in total, since the pending entry stays visible. A missed reminder never commits anything.

### 6.8 Result

```json
{"v":1,
 "items":[
   {"label":"Messages","disposition":"kept","location":"owner-storage"},
   {"label":"Drafts","disposition":"deleted","location":"app"},
   {"label":"Attachments","disposition":"archived","location":"owner-storage","note":"Saved as parley-archive-2026-10-22.tar"}
 ],
 "message":"Your messages stay in your storage. Reconnect any time to pick up where you left off."}
```

| Member | Meaning |
| --- | --- |
| `items` | At most 16 entries. `label` is required, 1–100 characters. `disposition` is `kept`, `deleted`, `archived`, `exported` or `other`. `location` is `owner-storage`, `app` or `elsewhere`. `note` is optional, at most 200 characters. |
| `message` | Optional, at most 500 characters. |

All text is inert plain text under the integrations §11.8 rules. The provider MUST present the result only as the app's own claim, attributed to its verified origin, and never as a provider verification. An invalid result is discarded; the outcome still applies.

### 6.9 Cancel

The owner may cancel an open removal at any time before the commit. Cancelling closes the record with `state: canceled`. A connection resumed from `suspended` at start (§6.1) stays resumed; the provider offers to suspend it again. Cancelling does not undo anything the app deleted.

## 7. Provider obligations around removal

### 7.1 Disclosure before either mode

Before the owner confirms, the provider MUST disclose:

- for force removal: that the app gets no chance to clean up, that data it holds and data it wrote to the owner's storage remain, and `access_ends_by` when brokered resources are involved;
- for clean removal: that the owner will be sent to the app's verified origin, that the app keeps all its access and keeps operating normally until it finishes or the owner removes it now, when the owner will be reminded (stated as a time), and that what the app reports afterwards is its own claim (UD-1);
- for force removal during a pending clean removal: that the app has not reported completion, so its cleanup may be interrupted;
- for both: the slot effects (§9.1), including every consumer that will lose an occupant and every integration that will return to `configuring`.

### 7.2 Audit

The provider records, as owner-visible metadata: start, mode, each reissue, each input with its channel, conclusion, `committed_at`, `access_ends_by`, and the acknowledgment of the resulting events.

### 7.3 What remains

A provider SHOULD offer the owner a view of what remains after removal: storage objects it can attribute to the app's writes, preference values of fragments no remaining app reads, bus records the app published, withdrawn contributed resources and the app's result (§6.8). The method of attribution is provider policy. A provider MUST NOT present a remaining-data view as complete when it cannot attribute writes, for example for brokered storage it is not on the path of.

## 8. Subject deletion

### 8.1 The `subject-deleted` event

| Event identifier (placeholder) | Payload beyond `connection`, `generation`, `seq` | Integration obligation |
| --- | --- | --- |
| `…/events/subject-deleted/v1` | none | The entity is permanently deleted at this provider. Treat the connection as `connection-revoked` with `terminal: true` for every generation, then purge, as §8.3 says, all state held for (`iss`, `sub`). |

The SET carries no personal data beyond its `sub` claim and the opaque connection identifier. It carries no reason, handle, email or deletion basis. It is a revocation-class event: it is always sent, whatever the manifest's `events` list says, and is delivered with revocation priority.

### 8.2 When it is sent

A provider declaring `subject-deleted.v1` sends it when an entity is permanently deleted: owner-requested deletion, operator-assisted deletion and inactivity purge alike. **Recipients.** It goes to every connection of that entity that was live when the entity's account-level severance began, and was not ended by the owner or by the app before then (RR1-H1):

- connections not `disconnected` or `manifest-invalid` at the deletion's severance commit, including `suspended` connections and connections with a pending clean removal; and
- connections the provider disconnected itself because of an account-level suspension, freeze or closure in the same account lifecycle that ends in this deletion. A provider that severs connections at suspension MUST record that reason on the connection tombstone so that this set can be computed.

It is never sent to a connection the owner removed (force or clean) or that the app ended. **User decision UD-3 (2026-10-22):** apps already removed are not told of a later deletion. Nor is it sent to a connection that was `manifest-invalid` at severance, because its origin may now belong to someone else.

- The provider enqueues it **in the same transaction as the severance commit** (for connections already severed by suspension, in the deletion's first severance transaction), after the `connection-revoked` row for the same connection.
- The provider MUST NOT dispatch it before the latest `access_ends_by` of that entity's severances (§4.3: at most commit + 360 s), so that no credential the app could still present anywhere, including brokered tokens at other integrations, is live when it learns of the deletion (RR1-M1).
- Delivery follows integrations §6.4: retries for at least 72 hours. The outbox MUST survive the entity's data wipe until it is drained or the window ends. Undelivered events are counted in the deletion record.
- Each attempt is signed afresh with the same `jti`.

It MUST NOT be sent for:

- suspension, recovery or an authority reset;
- removal of an app (force or clean);
- transfer of the identity to another provider. A moved identity is not deleted, and apps MUST keep its state;
- the end of an organization membership, including one caused by the member's own account deletion. The organization's integrations receive `member-removed` ([organizations §7.4](organizations.md#74-events)) under its existing rules. `subject-deleted` names an organization only when the organization entity itself is deleted.

### 8.3 Receiver processing

The receiver applies integrations §6.1 checks 1, 3–6, with these differences:

- **Lookup.** It resolves the subject by (`iss`, `sub`) as well as by connection. An app that discards its connection record on a terminal `connection-revoked` MUST keep enough to map (`iss`, `sub`) to the state it holds for at least 30 days, or it can never act on a `subject-deleted` that arrives after the revocation, which is the normal order (RR1-M6).
- **Unknown connection or subject.** It answers 202, without any network fetch and without processing, in the same response class as a processed event. This replaces "reject" in integrations §6.1 step 2 for this event type only, so the response never reveals whether the app knew the subject.
- **Idempotency.** A `jti` it has already processed is answered 202. Processing twice is harmless by construction: purging an already purged subject does nothing.
- **Scope.** It purges only state bound to the verified connection's entity: (`iss`, `sub`), or, for an identity that moved, the origin principal the app keys it by ([identity portability §8.1](identity-portability.md)). It never purges by `sub` alone, and never state of a different identity at another issuer.

On a verified event the app SHOULD, within 30 days:

- delete hot state in its own infrastructure: queues, mailboxes, sessions, caches and keys held for the subject;
- delete data derived from the subject's data, such as indexes, embeddings and analytics keyed to the subject;
- apply its backup policy to remaining copies.

It MUST NOT attempt to use credentials for the subject, and MUST NOT attempt to delete objects in the subject's storage resources: its authority has ended, and the provider deletes storage it hosts as part of the deletion.

Compliance cannot be verified or enforced. The provider sends the event; what the app does is the app's responsibility under its own policy. Providers MUST NOT describe the event to owners as a guarantee of deletion (§8.6).

### 8.4 Ordering and races

| Race | Resolution |
| --- | --- |
| `subject-deleted` arrives before `connection-revoked` | It implies terminal revocation. A later `connection-revoked` changes nothing. |
| A removal is open when deletion commits | The deletion's severance commit concludes the removal with `state: forced`. No redirect happens. `subject-deleted` is still sent to that connection. |
| The app already purged and a retry arrives | Unknown subject: 202, no processing. |
| A captured SET is replayed | Answered 202 while its `jti` is cached; later replays fail the `iat` window. A replay can only re-trigger a purge that already happened. |

### 8.5 Apps without an events endpoint, and what deleted identities answer

Apps without an `events_endpoint`, including every public client, receive no event, and this draft defines **no pull form** of the signal.

**Rule (RR1-R1).** Every surface that a party without the owner's authenticated session can reach answers for a deleted identity exactly as for an unknown one: directory and identity-document lookups with the uniform 404 of organizations §3a.2, and per-identity credentials (contact links, delivery tokens, delegation status) with the same refusal as an invalid credential. A distinguishable `410` is permitted only on surfaces where the caller already holds the owner's own session or a credential the owner issued to the owner, such as the provider's owner interface during and after a deletion. Connected apps learn of deletion through `subject-deleted`, which is the signal designed for them.

Public lookups deliberately answer a uniform 404 for unknown, suspended, deleting and deleted identities ([organizations §3a.2](organizations.md#3a2-handle-lookup)), and after a move's redirect period ends the source answers for a moved identity exactly as for a deleted one ([identity portability §10](identity-portability.md)). A distinguishable "deleted" answer would therefore leak lifecycle state, and would make apps purge identities that merely moved. An app that sees refresh fail with `invalid_grant` treats the session as ended and applies its own retention policy to the account; it MUST NOT treat that failure as proof of deletion.

### 8.6 Required disclosure

A provider declaring `subject-deleted.v1` MUST state in its privacy disclosures that apps are told about the deletion, that apps are separate parties, and that the provider cannot verify or enforce what they delete.

## 9. Interactions

### 9.1 Slots

Removal vacates every slot the connection occupies ([extensions §5.1](extensions.md#51-assigning-occupants)). It is a removal, not a replacement, so the extensions §3.4 per-consumer review does not apply to it. Choosing a replacement later is an ordinary assignment, with that review.

| Policy | Effect |
| --- | --- |
| `exclusive` | The field becomes absent: the slot is unconfigured. The provider MUST NOT automatically assign another candidate, including a built-in (extensions §5.1). Integrations whose `required: true` consumer declaration depends on the slot move to `configuring`. Provider consumers of the slot stop. |
| `ordered` | The occupant leaves the order, and the others keep their relative order. Consumers report outstanding ambiguous outcomes at the removed occupant as unknown (extensions §3.3). |
| `consumer-choice`, `broadcast` | The occupant leaves the pool. |

While a removal is pending the occupancy is unchanged and dispatch continues normally (§6.4, UD-1). Delegation-bearing slots, such as messaging ingress, revoke their delegations in the commit's cascade.

### 9.2 Preference fragments

**User decision UD-2 (2026-10-22):** preference values are owner data and are kept after removal (§4.2), including values of the app's own fragments. They are unreadable by the app after the commit because its grants are gone. A provider SHOULD offer to delete values of fragments that no remaining app or provider feature reads.

### 9.3 Event buses

Provider-hosted buses follow [events §8](events.md#8-revocation-and-lifecycle) for a disconnected connection: the app's subscriptions are deleted and its grants end. Records it published stay, with their producer attribution. A bus hosted by the removed app as a brokered occupant is detached (§4.1). Its records live at the app and are not recalled.

### 9.4 Brokered resources and severance

Removal uses integrations §7 unchanged. Clean removal adds a pending period before the commit; it never changes the commit, its ordering or `access_ends_by`.

### 9.5 Incremental-authorization suppressions

Suppressions are keyed by the entity and the app's site (the registrable domain of its verified origin), not the connection or the `client_id` ([incremental authorization §9](incremental-authorization.md#9-suppression); `packages/federation/suppression.mjs` `appSite`). Sibling clients on that site share them. Removal MUST NOT delete them, so a reinstalled app cannot ask again for what the owner blocked. The owner can still remove them from the provider's view of that app, which remains reachable after removal while any suppression or remaining data exists. They are deleted with the account.

### 9.6 Organization-installed apps

For an organization entity, "the owner" means members acting through the organization's owner interface under its provider policy ([organizations §6.3](organizations.md#63-owner-interface)). Removal is not a grant-management change. The removal request's `sub` is the organization entity and `bindle.actor` names the member who started it (§6.2). The app authenticates that exact member through its own member-context session, and applies its own authorization for that member before offering destructive choices (§6.3 step 7, RR1-H3). Members' data held in the organization's resources belongs to the organization (organizations §5.4) and follows §4.2. From the commit, the organization's provider refuses member-context presentations naming the app (§4.1).

Clean removal of an organization's app lets one member trigger app-side deletion of organization data. Starting it is therefore a critical action under the organization's provider policy (organizations-design ORG-D10), which a provider MUST define and disclose: for example a delay with every admin notified, or a second admin's approval. A provider using a delay MUST NOT issue the removal request (§6.2) before the delay ends. Force removal deletes nothing and is never delayed (RR1-H3). *Non-normative:* 3sln.me starts clean removal after a 24 h delay notified to every admin, any of whom may cancel or force it (Provisional (coordinator), not signed off by the user).

### 9.7 Account deletion

Account deletion performs a force removal of every connection inside its severance stage, with no redirect, then sends `subject-deleted` (§8). A provider SHOULD offer the owner clean removal of apps that declare it before deletion is requested.

### 9.8 Reinstall

After the commit, reconnecting requires a fresh authorization, creates a new generation and revives no grant (integrations §7.4). Suppressions persist (§9.5). Preference values and storage objects that remain are available again only through fresh grants.

## 10. Security requirements

1. **Owner-only start and cancel.** Only an explicit owner action at the provider starts, cancels or forces a removal. No app, return, back-channel request or navigation parameter can start or cancel one.
2. **Provider-pinned destination.** The provider navigates only to the pinned `removal.uri`, never to a URL taken from a request. The return redirects only to provider console paths.
3. **Audience, purpose and type separation.** Removal requests use their own `typ`, `purpose` and `kid`. The issuer RPC, token, introspection and event endpoints MUST reject them. Apps MUST check `typ`.
4. **Lookup before fetch.** Apps resolve a local relationship before fetching keys (§6.3). Providers resolve the client locally before verifying back-channel assertions (§6.6).
5. **No authority in the request.** A removal request grants nothing. A leaked request lets its holder see the app's removal page, which still requires the user's own app session and an explicit choice before anything is deleted.
6. **Owner remedy at all times.** A pending removal changes no authority (UD-1). Force removal is available throughout and is the primary action after the reminder (§5, §6.7).
7. **Framing.** Provider removal pages use `frame-ancestors 'none'` and the provider's delay-to-arm controls. The app's removal page MUST send `frame-ancestors 'none'` (§6.4).
8. **Uniform responses.** The return page, the back-channel endpoint and `subject-deleted` processing for unknown subjects reveal nothing about other removals, connections or subjects.
9. **Bounded state.** One open removal per (entity, `client_id`). Result size, request rate and reissue count are bounded.

## 11. Conformance tests

- **Manifest:** path-prefix and collision violations; `back_channel` in a public client; snapshot changes during an open removal.
- **Force:** every §4.1 row revoked in one commit; nothing in §4.2 touched; force during a pending clean removal, before and after the reminder; force for `manifest-invalid` and `suspended`.
- **Clean:** start preconditions, including `manifest-invalid` and security suspensions refused; request claims, lifetime and reissue with an unchanged `cleanup_by`; `bindle.actor` present exactly for organization entities; every §6.3 check in order, with no fetch for an unknown relationship and identical failure pages; URL scrubbing.
- **Pending:** credentials, grants and dispatch unchanged before and after `cleanup_by`; each scheduled reminder fires once and never commits; force available and primary after the reminder; a second connection for the same client refused.
- **Return:** each outcome on each channel; `in-progress` without back channel stays open; a return from a browser without the start binding asks before committing; wrong account; unknown and concluded identifiers; result validation and attribution.
- **Concurrency:** front and back channel racing; completion racing the reminder; completion racing force; double completion; reissue after conclusion.
- **Subject deletion:** enqueued with the severance commit and after `connection-revoked`; dispatched no earlier than `access_ends_by`; sent to connections severed by an earlier account suspension or closure in the same lifecycle; not sent to removed apps; not sent on suspension, removal, transfer or membership end; unknown subject answered 202 with no fetch; replay; retries across the wipe; no personal data in the payload.
- **Interactions:** each slot policy; suppressions kept; bus subscriptions deleted and records kept; organization actor audit.

## 12. Amendments needed — proposed (unsigned)

| ID | Document | Amendment |
| --- | --- | --- |
| AR-1 | integrations §2.1, §2.2 | Add the `removal` member. A public client MAY carry `bindle_integration` with only `v` and `removal`. `back_channel` requires a confidential client. |
| AR-2 | integrations §3.1 | No new connection state (UD-1). A pending removal is a provider record. Starting clean removal from an owner-chosen `suspended` is a resume; the conclusion is `disconnected`. Connection tombstones severed by account-level suspension record that reason (§8.2). |
| AR-3 | integrations §6.1, §6.2 | Add `subject-deleted` as a revocation-class event, with the §8.3 replacement of step 2 for unknown connections. |
| AR-4 | integrations §7.1 | Add rows "Remove (force or clean conclusion)" (the §4.1 commit, `connection-revoked` terminal) and "Delete subject" (adds `subject-deleted`). |
| AR-5 | integrations §5.3 | The brokering key set MAY also hold removal-request keys with their own `kid`, used for nothing else, when `app-removal.v1.jwks_uri` names the same document. |
| AR-6 | protocol §2 feature table | Add `app-removal.v1` and `subject-deleted.v1`. |
| AR-7 | organizations §5.4, §7.4 | State that a member's account deletion produces `member-removed`, never `subject-deleted`, for the organization's integrations. |
| AR-8 | incremental authorization §9.2 | State that suppressions survive removal, and that the provider's view of a removed app stays reachable while any exist. |
| AR-9 | identity portability §5–§10 (owned by its author) | A transfer-out, the end of its redirect period and any later cleanup of the moved identity at the source MUST NOT emit `subject-deleted`. Only deletion of an identity that has not moved emits it. If the source's cleanup reuses the deletion executor, it passes a distinct severance reason (for example `moved`) that the `subject-deleted` hook skips. |
| AR-10 | intents §5, §7 (owned by its author) | The `intents` and `removal` members share one manifest validation call site and one rule for a public client's minimal `bindle_integration` (AR-1). Removal clears handler defaults (intents §7.3, already stated) and keeps exclusions (intents §7.4). |
| AR-11 | organizations §6.3, §7 | Clean removal start is a critical action under provider policy (§9.6). Member-context presentations naming a removed client are refused from the commit. |
