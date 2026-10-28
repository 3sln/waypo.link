# 3sln.me security policy and release gates

> **Group:** 3sln.me reference service
>
> **Status:** proposed. The runnable local service is not a production identity provider until these gates are implemented and reviewed. Production release remains disabled.
>
> **Covers:** 3sln.me's reference-host presentation and framing policy, its account abuse controls, audit and operational controls, and the verification required before a public beta.
>
> **Does not cover:** the interoperable Bindle security model that every provider follows, which is [Bindle security](../spec/security.md). This document applies that model to one host and adds host policy; another provider may choose differently.

## Reference-host presentation and framing (3sln.me policy)

This section is 3sln.me reference-host and `@3sln/bindle` SDK policy, not Bindle interop. It was moved out of [auth](../spec/auth.md) and [protocol](../spec/protocol.md) on the user's 2026-10-14 direction that the Bindle specification say nothing about UI. Other providers may choose differently. Design: [adaptive app sign-in](../architecture/adaptive-app-sign-in.md).

- **Handle entry.** The `@3sln/bindle` sign-in element shows the framework brand, an editable handle and a visual `@3sln.me` suffix until `@` is typed; submission resolves the complete handle, and the element names the resolved provider host before navigating.
- **Framing.** Login, account management, consent, recovery and console pages send `frame-ancestors 'none'` and `X-Frame-Options: DENY`. The only framed provider documents are the `/embed` island shell (with `/embed/assets/*`, `/embed/api/*` and `/embed/sw.js`) on a dedicated cookieless embed origin (never the console origin), with `frame-ancestors` set to the exact registered origins of the `client_id`, display-only authority, no cookies read, and every sensitive action escalated to a top-level popup or FedCM. Consent never happens in a frame.
- **Popups.** Authorization pages use `Cross-Origin-Opener-Policy: same-origin`, a static cookie-independent entry document, controls inert until visible and focused for 600 ms, and no default focus on approve. Completion is a top-level redirect to the registered redirect URI. The one exception is the single static entry document for popups opened by the embed frame, served without COOP so the opener survives; it refuses to run framed or sandboxed, shows no account state until an opener-key handshake succeeds, otherwise replaces itself with the `COOP: same-origin` authorization page, and posts only a key-bound claim and the code to the embed origin with an exact `targetOrigin`.
- **Islands** ([embed islands](../architecture/embed-islands.md)). Only allowlisted parts (`avatar`, `account-switcher`, `sign-in`) load; sizes are fixed or set by the embedder, never by state; islands send no state-dependent messages, sizes, focus or error signals; avatar responses are re-encoded rasters with `Cross-Origin-Resource-Policy: same-origin`, no CORS and `no-store`; the partitioned service worker never caches API responses; `/embed/api/*` requires an exact embed `Origin` on non-GET requests and on any GET that carries one.
- **FedCM cookie.** The only `SameSite=None` provider cookie is `__Secure-bindle_fedcm` (`Path=/fedcm/api/`, HttpOnly, not partitioned), holding session-class FedCM-purpose capabilities (rotated on every install, revoked with their sessions) rather than console session tokens; every `/fedcm/api/*` handler requires `Sec-Fetch-Dest: webidentity` before reading cookies, and FedCM login/continuation pages live outside that path and authenticate with the Strict cookies. Per-account login cookies stay `SameSite=Strict`.
- **Browser app credentials.** Persistent browser refresh tokens are issued only DPoP-bound. Embed credentials are delivered only to the embed frame, bound to its non-extractable key, never reach the app and never authorize RPC.

Verification before public beta: framing refusal on every non-embed route; embed `frame-ancestors` under allowed, unregistered and nested parents; FedCM endpoints refuse non-`webidentity` requests with identical timing; embed restore fails with another key, client or site; refresh reuse revokes the client session and its embed token; R1 one-click sign-in for an already signed-in user in Chromium (FedCM and popup), Firefox and WebKit. Islands: size, load-count, timing and focus probes identical across account states; popover close matrix; leader failover across tabs; avatar hotlinking refused from other origins and as a top-level or `<img>` load from the embedder.

## Account abuse controls (3sln.me policy, provisional 2026-10-23)

From the identity and federation wargame of 2026-10-23; Reviewer ___ / Date ___ / Outcome ___. Anything keyed to a victim (handle, mailbox, account, owner shard) is charged only after the caller has passed a CAPTCHA or proved a credential, so unauthenticated traffic cannot lock a person out. Per-network windows run first. Sign-in charges the handle window only for completed, failed password checks; passkey sign-in begin stores nothing. Email sign-in charges a mailbox window for every address alike and answers in constant time. A pending setup token buys at most 5 password sets and 5 recovery downloads behind the limiter. Anonymous app authorization requests have their own per-caller and per-shard bounds and join the owner's bound only at the owner step; incremental DPoP proofs are recorded only once a code bound to that key exists, in per-key partitions. The admin console accepts only a passkey step-up; boot challenges are per-caller rows bound to a nonce cookie, and boot password attempts have principal and global ceilings. A stolen password cannot replace the recovery file of an account with a passkey, and any reissued file waits 7 days before it can recover, during which earlier devices, the pre-existing email and the previous file can cancel it ([recovery identity](accounts/recovery-identity.md#active-account-reissue-provisional)). Evidence: `tests/identity-wargame2.test.mjs`, `tests/federation-wargame2.test.mjs`, `tests/boot-admin.test.mjs`. Local engine and Node evidence only; no production verification is claimed.

## Audit and operational controls

Record account and grant changes, credential enrollment/removal, session transitions, connector lifecycle and denied privilege expansions. Audit events omit raw tokens, challenges, credentials, preference values, file contents and unnecessary email addresses. Users can inspect relevant events; production retention and deletion policies need explicit sign-off. Separate security telemetry from user exportable event history. Encrypt secrets/backups, test restore and key rotation, and document recovery from provider compromise. No production email, integration credentials or deployment changes are necessary for the local prototype.

## Required verification before a public beta

| Boundary | Minimum meaningful verification |
| --- | --- |
| Discovery | 404/410 vs transient error; malformed manifests; origin mismatch; redirects; unsupported schema; IDNA and userinfo input. |
| OAuth | PKCE downgrade rejection; reused/expired code; wrong state/issuer/client/redirect; open redirect attempts; no secret in URL/log; revoked grants with live tokens. |
| Email | Every lifecycle table row in [sign-in and sessions](accounts/sign-in-and-sessions.md#3slnme-email-sign-in); mail scanner GET no-op; atomic parallel claims; stale email/account revisions; browser-session mismatch; recovery-disabled account. |
| Passkeys | Wrong origin/RP/challenge/type/signature; replay; missing verification; account binding; enrollment/deletion authorization; synced counter handling. |
| Authorization | Cross-user/client/resource/method rejection; assignment removal immediate; expansion consent; immutable revision checks; optional fragment privacy; @profile restrictions. |
| RPC | Payload-changing idempotency collision; cross-principal tx IDs; revocation on replay; race between revoke and mutation; bounded resource exhaustion. |
| Network | Private/IPv6/metadata and redirect targets; DNS rebinding; compressed oversized content; hostile schema nesting; connectors returning unsafe paths/content. Client ID metadata documents (`client-id-metadata.v1`): verified Workers egress against private and rebinding targets before declaring the feature in production. |
| Consent | User tests accurately identifying recipients, field data, resource powers, shared-fragment consequences and revocation limits; keyboard/screen-reader flow and cancellation. |
| Deployment configuration | A deployed Worker never sets `LOCAL_DEVELOPMENT=true`: that flag only belongs with a loopback `http` `APP_ORIGIN` (provisional, 2026-10-23). The region policy already ignores it on a non-loopback origin (unknown locations stay blocked), but other local relaxations still key on it. No runtime assertion exists, because Worker test fixtures combine the flag with `.example` origins; verify the production `wrangler.jsonc` value (`"false"`) before release. |
| Operations | No secret leakage; connector disconnect; encrypted backup restore; rate-limit abuse and enumeration review; dependency/security review. |

Tests should exercise invariants against the actual persistence and broker paths, not merely duplicate validation functions. Consent comprehension needs human research before claiming the UI is intuitive. Independent security review is appropriate before storing public users' credentials or brokering production integrations.

## Sign-off checkpoints

- [ ] **S3 — Connector scope:** supported providers and permitted bucket/folder scope approved before production implementation.
- [ ] **S4 — Production gate:** auth/grant/race/SSRF verification, consent research and security review complete.
- [ ] **S5 — Operations:** retention, recovery, backup, key custody and incident plan approved.

Reviewer / date / notes: _pending; local drafting and implementation may proceed._
