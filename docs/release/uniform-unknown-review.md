# U404 public unknown inventory — 2026-10-22

Implementation/review record, not release approval. Reviewer ___ Date ___ Outcome ___. DEVLOG.md is intentionally unchanged under the workstream instruction.

The workstream's explicit 404 requirement takes precedence over the older contact-link 401 and unknown-delegation `revoked` exceptions in app-uninstall §7.5a/account-deletion-export §2.4. Those documents are reconciled to this instruction and remain unsigned. The 404 covers **target** lookups, where the request names an identity, link or owner. **Credential** surfaces keep their standard protocol refusal (app-uninstall §7.5a, "Boundary"). Those surfaces are bearer/DPoP tokens, refresh tokens and codes, object capabilities, embed credentials, MCP tokens, prepared postback capabilities and brokering client assertions. Their refusal is the same whether the credential is invalid or its own account is deleted, deleting, suspended or moved, and it is never 404 or 410. This is a public wire-contract change only for target lookups.

**Correction (2026-10-22).** An earlier pass of this workstream also turned credential refusals into 404. That came from `lookupUnknown`, which treated `unauthorized`, `invalid_token`, `invalid_grant` and `conversation_unauthorized` as unknown targets. It broke RFC 6749/6750/7662/9449 client semantics, and 16 protocol test files had been rewritten to match. That has been reverted. `lookupUnknown` now covers only lifecycle faults and not-found. `contactUnknown` adds the link/delivery-token refusal for contact routes only, because the link names the target. Serializers map a lifecycle fault on a credential's own subject (`lifecycleUnknown`) to the invalid-credential answer. The original protocol assertions are restored. Owner session, CSRF, grant-management and account RPC lifecycle faults retain their existing behavior. Protocol syntax, origin, rate-limit and infrastructure failures remain distinct.

| Public surface | Boundary / treatment |
| --- | --- |
| `GET/HEAD/POST /users/:handle/contact/:id`, legacy `sig` and `bindle_meta`; inspection, profile, intake, invitation and delivery-token representations | `routes/contacts.mjs`: missing/inactive directory entries, invalid/missing capabilities and account lifecycle faults use the same 404 body and full representation/CORS headers. The delivery promise is awaited inside the boundary catch, including a fence committed after credential verification. |
| `GET/HEAD` contact HTML/OG, `/oembed?url=…`, contact `/avatar` | Unknown previews retain the identical generic HTML/oEmbed content with 404. Unknown avatars give 404 without a redirect. Profile lookup already catches all account failures. No per-identity cache validator or token expiry header is retained. |
| `GET/HEAD` contact ingress descriptor | `routes/links.mjs`: unknown links/identity/lifecycle are 404, including the interval before identity tombstoning. Actual occupant/describe infrastructure unavailability keeps its existing 503. |
| `POST /bindle/rpc` contact-delivery JWT | `routes/delivery.mjs`: early unknown identities and late credential/lifecycle faults share the same 404 body and headers; no late Retry-After survives. |
| `/api/conversations/identity/:owner`, `/invitations/:owner`, `/inbox/:owner`, `/:owner/:room/join`, bearer `GET/POST /:owner/:room` including receipt reads | `conversations/http.mjs`: missing identities, missing rooms, refused capabilities and lifecycle faults share the route's 404. Owner conversation routes remain separate. |
| `GET/HEAD /identity/:sub/delegations/:jkt` | Unknown subject/key and lifecycle refusal give identical no-store 404. The public RPC no longer opts into purging access: the deletion fence must win before reading known certificates. Explicit persisted revocations of an active identity retain their protocol result/cache policy. Owner certificate management is unchanged. |
| `POST /api/oauth/requests` identity admission | The `PublicIdentityAvailable` edge Query reads the identity provider and dispatches `PublicAccountAvailable` through the account single writer. Directory `active` alone cannot bypass a deletion fence. No probe is sent for an unknown/inactive identity. This uses existing providers and lifecycle policy. |
| `/oauth/authorize`, `/api/oauth/requests` (target) | An unknown or lifecycle-faulted identity named in the request gives the uniform 404 in `federation/http.mjs`. |
| `/oauth/token`, bearer and DPoP `/bindle/rpc` (credential) | Invalid, expired, revoked or replayed tokens keep `400 invalid_grant` / `401 unauthorized` (DPoP with `WWW-Authenticate`). A token or grant whose own account is deleted, deleting, suspended or moved gets that same refusal, including lifecycle error envelopes returned by `rpc`. Write RPC lifecycle faults reach the boundary rather than becoming a misleading `indeterminate`. Owner `/api/oauth/requests/:id`, decisions, preferences and grants keep their serializers. |
| Device-code and incremental-code `/oauth/token` branches (credential) | A lifecycle fault on the grant's own account becomes `400 invalid_grant`, the same as any spent or unknown code. Nonce challenges and syntax/overload responses keep their existing protocol responses. |
| `POST /oauth/brokering/introspect` (credential) | Unchanged from HEAD: client-proof and connection failures give `401 invalid_client` with `WWW-Authenticate`; an inactive token gives `200 {active:false}` (RFC 7662). |
| `GET/PUT /bindle/objects/:capability` (credential) | Capability refusal stays `401`. A capability whose own account is deleted, deleting, suspended or moved gets the same `401 unauthorized`. A missing object behind a valid capability keeps its existing 404. |
| `/mcp`, `/mcp/oauth/token` (credential) | Unchanged refusal semantics: `401 invalid_token` with `WWW-Authenticate`, and `400 invalid_grant` at the token endpoint. A token or grant whose own owner has a lifecycle fault gets that same refusal; collections are resolved before the SDK handler so the fault reaches this mapping. Owner `/api/mcp/*` is unchanged. |
| Dedicated-origin `/embed/api/{session,state,forget,claim,session/end,events,avatar}` (credential) | Unchanged from HEAD: constant `401 unauthorized` denial, with the avatar's fixed response deadline/CORP/CSP. The static island shell/assets and nonce creation do not resolve an identity. Existing event streams keep their disconnect-on-lost-authority behavior. |
| Prepared cookie-free `POST /api/messages/:id/postbacks` (credential) | Invalid or expired capabilities stay `401`. In both the terms preflight and the dispatch, a capability whose own owner is deleted, deleting, suspended, moved or otherwise inactive gets the same `401 unauthorized` body. Cookie-authenticated message APIs are unchanged. |

Not additional public identity lookups:

- The directory.v1 directory and `/identity/:sub/identity.json` documents are not mounted/advertised. Platform asset misses remain identity-independent. `/api/contacts/directory` and beam contact profiles require the owner's session and represent that owner's contacts.
- Waitlist start/confirm/leave operate on waitlist email/proof records, not account identities; they do not consult the identity/account providers. Their generic acknowledgements remain unchanged.
- OAuth entry/device-request creation stores opaque hints; provider page selection/approval authenticates the owner. Revocation and embedded session ending intentionally acknowledge unknown credentials without identity disclosure. Provider/JWK discovery, integration schemas, email-bridge public keys, object contracts, static landing pages and Google callback forwarding do not resolve account identities.
- Unsubscribe, recovery, email proof, account deletion-cancel and setup flows carry their own proof/owner authority. Their existing generic invalid-proof handling does not expose lifecycle faults. Owner exports, storage, devices, admin and deletion APIs remain owner-authenticated.

Validation scope:

- `tests/helpers/public-unknown.mjs` inventories requests shared by Node and real workerd HTTP-router tests, split into `targetSurfaces` and `credentialSurfaces`. Target surfaces must give the same 404. Credential surfaces must give one 400/401 response, never 404 or 410, across `credentialCases`. Those cases are native invalid credentials (the `deleted`/`moved` fixtures) and lifecycle-faulted credential subjects (deleting, suspended, an arbitrary 410). The fixture previously passed the string `'true'` for the boolean-only `BROKERED_INTROSPECTION_MOUNTED` flag, so its introspection "404" was really the router's catch-all. It now mounts the handler. Each target surface compares complete body/status and all headers except platform transport framing/date across an active identity with a missing resource, a still-active directory entry behind a deleting fence, deleted, never-created, suspended, moved and an arbitrary 410 fault. The boundary fixture injects provider faults; it is not external-provider conformance evidence.
- `tests/engine-public-unknown.test.mjs` uses real AccountController/ngin/SQLite. It commits the deletion fence between successful signed-link verification and delivery, verifies owner/internal 410 preservation, exercises the public admission Query and runs twelve seeded lookup/fence schedules with `tests/helpers/chaos.mjs`.
- Existing durable Node/Worker protocol tests retain real credential, storage, revocation and recovery checks; their original credential refusal assertions (401/400) are kept, and only genuine target-surface expectations (contact, link, delivery, conversation, delegation) are updated to 404. `tests/federation-runtime.test.mjs` adds a check that a credential whose account is deleting gets 401 at `/bindle/rpc`, never 404/410 or `indeterminate`. Production capability, external delivery and deployment are not inferred from local tests.

The fixed avatar deadline is retained. Other routes add no sleeps, lifecycle-specific retry or status-dependent cache behavior; directory and account lookup/RPC work still has the unavoidable presence-dependent cost. No constant-time network claim is made.

## Local verification outcome

After the credential-semantics correction (2026-10-22):

- `npm test`: 2417/2417.
- `npm run test:worker`: 77/77, including the split target/credential matrix in real workerd.
- `npm run test:ui-state`: 291/291.
- `npm run test:e2e`: 214 passed, 0 failed, 4 skipped. The four skips are WebKit tests; the WebKit browser is not installed locally.
- `npm run build:assets`, `npm run check:worker` (dry run only), and `git diff --check`: passed.

DEVLOG.md was not edited. No commit, deployment or operator-secret change was performed by this workstream.

## Changed files

Engine and public boundaries:

- [packages/app/domains/public-identity.mjs](../../packages/app/domains/public-identity.mjs)
- [packages/app/edge-operations.mjs](../../packages/app/edge-operations.mjs)
- [packages/app/operations.mjs](../../packages/app/operations.mjs)
- [packages/conversations/http.mjs](../../packages/conversations/http.mjs)
- [packages/federation/http.mjs](../../packages/federation/http.mjs)
- [packages/federation/runtime.mjs](../../packages/federation/runtime.mjs)
- [packages/mcp/http.mjs](../../packages/mcp/http.mjs)
- [packages/runtime/account/identity.mjs](../../packages/runtime/account/identity.mjs)
- [packages/runtime/incremental-authorization.mjs](../../packages/runtime/incremental-authorization.mjs)
- [packages/runtime/public-unknown.mjs](../../packages/runtime/public-unknown.mjs)
- [packages/runtime/routes/contacts.mjs](../../packages/runtime/routes/contacts.mjs)
- [packages/runtime/routes/delegation.mjs](../../packages/runtime/routes/delegation.mjs)
- [packages/runtime/routes/delivery.mjs](../../packages/runtime/routes/delivery.mjs)
- [packages/runtime/routes/federation.mjs](../../packages/runtime/routes/federation.mjs)
- [packages/runtime/routes/identity.mjs](../../packages/runtime/routes/identity.mjs)
- [packages/runtime/routes/links.mjs](../../packages/runtime/routes/links.mjs)
- [packages/runtime/routes/messages.mjs](../../packages/runtime/routes/messages.mjs)
- [packages/runtime/routes/shared.mjs](../../packages/runtime/routes/shared.mjs)
- [packages/storage/object-http.mjs](../../packages/storage/object-http.mjs)

Tests:

- [tests/beaming-runtime.test.mjs](../../tests/beaming-runtime.test.mjs)
- [tests/contact-preview.test.mjs](../../tests/contact-preview.test.mjs)
- [tests/core-links-handoff-http.test.mjs](../../tests/core-links-handoff-http.test.mjs)
- [tests/engine-public-unknown.test.mjs](../../tests/engine-public-unknown.test.mjs)
- [tests/federation-runtime.test.mjs](../../tests/federation-runtime.test.mjs)
- [tests/helpers/public-unknown.mjs](../../tests/helpers/public-unknown.mjs)
- [tests/key-delegation.test.mjs](../../tests/key-delegation.test.mjs)
- [tests/landing-console-routing.test.mjs](../../tests/landing-console-routing.test.mjs)
- [tests/links-http.test.mjs](../../tests/links-http.test.mjs)
- [tests/node-contact.test.mjs](../../tests/node-contact.test.mjs)
- [tests/public-unknown.test.mjs](../../tests/public-unknown.test.mjs)
- [tests/recovery-identity-runtime.test.mjs](../../tests/recovery-identity-runtime.test.mjs)
- [tests/worker/contact.test.mjs](../../tests/worker/contact.test.mjs)
- [tests/worker/public-unknown.test.mjs](../../tests/worker/public-unknown.test.mjs)

Architecture and review record:

- [docs/architecture/account-deletion-export.md](../../docs/architecture/account-deletion-export.md)
- [docs/architecture/app-uninstall.md](../../docs/architecture/app-uninstall.md)
- [docs/release/uniform-unknown-review.md](../../docs/release/uniform-unknown-review.md)

