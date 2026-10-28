# Sign-in, passkeys and sessions on 3sln.me

> **Group:** 3sln.me reference service
>
> **Status:** implemented locally (Worker and Node adapters) as 3sln.me account policy; provisional; production release remains disabled and nothing here is production-verified. Hosted email delivery is a configured external service with its own verification.
>
> **Covers:** how 3sln.me signs in its own account holders: passkeys, optional passwords, email sign-in links, the hosted recovery-file transaction, browser (owner) sessions and their management, and the app-session lifetime values 3sln.me chooses within the Bindle ceilings.
>
> **Does not cover:** approving a sign-in from another device. A signed-in browser approving another browser (**session handoff**, which yields an ordinary 3sln.me session) and a CLI or TV app signing in with a code (**app sign-in with a code**) are in [approve a sign-in](approve-a-sign-in.md). App grants and their lifetime ceilings are Bindle rules: [auth](../../spec/auth.md) and the [device authorization](../../spec/extensions/device-authorization.md) extension. Device authorization does not replace or supersede anything here: it issues an app grant, not a provider session.

This document is the 3sln.me reference service's own sign-in policy. It is not part of the Bindle specification; another provider may sign its users in however it chooses. It was formed on 2026-10-27 from the passkey and session parts of the former `device-login.md` and the hosted-account sections of the former auth spec (local clients spike CR-A1).

## Passkeys and browser sessions

An owner can enroll up to five verified passkeys, inspect safe credential metadata, rename labels and remove a credential. Enrollment is a fresh WebAuthn registration ceremony bound to the exact RP/origin, account, expiring challenge and initiating owner session. Enrollment, removal and session revocation require a session authenticated within 15 minutes and exact-origin/session CSRF checks. Removing a passkey requires a remaining working password or passkey and a configured recovery-file hash. Removing a credential revokes login sessions created using that credential. A verified email remains contact-only unless its owner explicitly enables email login. Email login is disabled by default; disabling it invalidates outstanding links, while file recovery remains unchanged. Passkey removal does not treat contact verification as a replacement working credential.

Sessions have opaque management IDs distinct from their authentication tokens. Device lists contain label, creation, last-use and expiry times plus a current-session marker. Session-token hashes and other sessions' CSRF tokens never leave this view. Labels are bounded, untrusted plain text rather than verified hardware descriptions. Existing sessions receive stable derived public IDs without exposing their token hashes. Owners may revoke one selected session, all others or their current session. Last-use persistence is throttled to once per minute; concurrent telemetry conflicts do not fail reads.

## 3sln.me email sign-in

Sending email never creates an account. A request creates an expiring verification challenge, with purpose `login` or `link`, a hash of a random secret (at least 256 bits), intended email, initiating account for linking, initiating browser transaction, and allowed return target. Replies are generic regardless of account existence. Apply mailbox/IP/device/global rate limits without permanently locking a mailbox due to an attacker's requests. Reference host (wargame 2026-10-23, provisional): after the Turnstile check, a pseudonymized mailbox window (5 per 15 minutes, 20 per day) and a global window (2,000 per hour) are charged whether or not the address has an account; both branches do the same token work, and the challenge write and the provider call run in the background on a hit (the platform's `waitUntil`), so neither latency nor provider errors reveal whether an address can sign in. Only registered redirect targets are accepted; links cannot carry arbitrary return URLs.

Magic links are valid for ten minutes and single-use. GET renders a confirmation page and MUST NOT consume the token, create an account, associate an email, or authenticate: mail scanners prefetch links. Redemption is an explicit CSRF-protected POST. Token material must be removed from the address bar after delivery into a temporary server-bound interaction; use `Referrer-Policy: no-referrer`, no analytics or third-party assets, and scrub query strings from logs. Cross-device links can complete mailbox verification, but cannot approve the initiating app's authorization transaction without a fresh flow on the consuming browser. Show the app/provider context; prevent login CSRF by requiring explicit acceptance before replacing an existing session.

Account and email changes run in one database transaction with a unique canonical email ownership constraint and consumed-token compare-and-swap. Domain normalization alone defines canonical comparison; local-part semantics cannot safely be guessed. Repeated redemption returns an expired/used result; it cannot replay success or expose the account.

| Verified challenge and current browser state | Required outcome |
| --- | --- |
| Unclaimed email; no session | Explain new account, obtain explicit account creation confirmation, then create subject and associate email atomically. |
| Email belongs to A; no session | Explicit login confirmation authenticates A. No account creation. |
| Unclaimed email; already signed into A; login-purpose link | Offer attach to A or create a separate account. Neither happens automatically. Attaching requires recent A authentication and explicit confirmation; separate account switches session only after confirmation. |
| Email belongs to A; signed into A | Confirm same account; complete eligible login transaction. |
| Email belongs to B; signed into A | Explain different account; offer cancel or explicit switch to B. Never attach B's email to A, transfer it, or merge accounts. |
| Link-purpose challenge initiated by A; signed into A | Require recent authentication and explicit attach; atomically claim only if unclaimed or already A. |
| Link-purpose challenge initiated by A; no session | Require login to A before continuing; mailbox proof alone cannot authorize modification of A. |
| Link-purpose challenge initiated by A; signed into B | Require switching/authenticating A; do not rebind the challenge to B. |
| Email claimed by another account after link sent | Reject attachment, preserve ownership; offer separate login flow. |
| Expired, used, malformed or wrong-purpose token | Generic invalid-link screen and explicit resend; no mutation. |
| Token forwarded or opened on another device | Mailbox token is transferable proof; present full context, require explicit acceptance, and begin a fresh app authorization transaction on that device. |
| Email removed after challenge issued | Account/email revision check invalidates outstanding login challenges; fresh flow reflects current ownership. |
| Account deleted/suspended after challenge issued | Reject; do not resurrect or silently rematerialize the account. |
| Concurrent redemption/create/link | Exactly one atomic transition succeeds; uniqueness prevents duplicate ownership. |
| User changes mailbox input during flow | Issue a new challenge; never retarget an existing token. |

Account settings list verified emails, verification dates, primary contact, passkeys, sessions, and grants. Adding/removing emails requires recent authentication; new addresses must be verified. Notify existing contact channels of sensitive changes without leaking secrets. Removing an email invalidates its outstanding challenges. Never permit removal of the last usable recovery/login method without enrolling another. Mailbox proof is a recovery factor; administrators must not invent bypass merges. Account merge and identity migration are explicitly outside v0.

Email authentication proves current mailbox control, not legal identity or durable ownership. Recycled mailboxes can recover accounts still linked to them. Explain this when enabling email recovery; users may opt out of email recovery after enrolling sufficient alternative credentials. A passkey-protected account configured without email recovery MUST NOT be recovered through an email login link. A verified email may remain a contact address without being an authentication method. Hosted account records implement this with `emailLoginEnabled=false` by default. A recently authenticated owner explicitly enables or disables it with CSRF protection after verifying the mailbox; linking alone grants no login authority. Both link issuance and redemption check the current setting. Disabling removes outstanding login challenges so re-enabling cannot revive an old link, and changing the verified contact disables email login until the owner opts in again.

## Hosted recovery-file transaction

The original recovery file starts one pending recovery transaction and revokes old sessions and authenticators. Its hashed resume authority remains only while that account is recovering, so lost HTTP responses or an expired 30-minute setup token do not strand an account with no other recovery channel. A CAPTCHA/rate-limit guarded resume rotates the limited setup token without clearing completed replacement credentials. The user must still prove possession of a newly downloaded replacement file and confirm saving it before activation. An active owner can replace the file (the active-account reissue); a reissued file cannot start a recovery for 7 days and the previous file can only cancel the reissue during that window ([recovery identity](recovery-identity.md#active-account-reissue-provisional)). Activation atomically removes the original file’s resume authority; it cannot replay completed recovery or issue a full session on its own. Setup and resume secrets never enter audit events or logs.

## Passkey verification

Use maintained server-side WebAuthn verification, not handwritten cryptography. 3sln fixes its RP ID and permitted HTTPS origin list in deployment configuration; never derive them from request headers. Challenges are random, single-use, short-lived, and bound to purpose and session. Validate challenge, origin, RP ID hash, type, signature, user presence and required user verification. User handles are stable opaque bytes unrelated to email. Registration requires an authenticated recent session; login uses discoverable credentials or an explicit handle, with enumeration-safe errors. Reference host (wargame 2026-10-23, provisional): the handle-login challenge is not stored; the begin token is `pl1.<payload>.<mac>`, a keyed MAC over {handle, challenge, nonce, expiry}, so begin reads no account, writes nothing, reveals neither an account id nor whether or in what state a handle exists, and cannot evict another caller's challenge. Finish verifies the MAC and the assertion, then records the nonce as used in the session's own write (single use). Sign-in abuse windows: only per-network windows run before Turnstile; the per-handle window (20 per 5 minutes) is consulted after it and charged only by a completed, failed password check; passkey begin and finish never touch it. Store credential public keys, IDs, transports, backup flags, counters and a user-chosen label. Synced passkey counters can be nonmonotonic; evaluate anomalies without assuming every zero/nonincrease is a cloned authenticator.

Require user verification for account management and passkey login. Do not require attestation for ordinary individual users. Offer enrollment after materialization, additional passkeys, last-used metadata, and removal with recent authentication and recovery-method checks. Passkeys remain provider-scoped: a self-hosted provider uses its own RP ID. Lost-device recovery follows the user's configured factors; no automatic downgrade to email when disabled.

## App session lifetimes on 3sln.me

These are 3sln.me's values within the ceilings of [auth §"Token lifetime and client sessions"](../../spec/auth.md#token-lifetime-and-client-sessions) and [device authorization §7](../../spec/extensions/device-authorization.md#7-credential-lifetime) (user decision 2026-10-20, provisional):

- Access tokens: at most 15 minutes (Bearer) or 60 minutes (DPoP-bound), configurable shorter with `APP_ACCESS_TOKEN_MINUTES` and `APP_DPOP_ACCESS_TOKEN_MINUTES`. 3sln.me issues Bearer access tokens alongside a DPoP-bound refresh token (proposed).
- Client sessions have no absolute lifetime. The idle limit is 180 days since the last refresh (`APP_REFRESH_IDLE_DAYS`, 1–365), for every app grant, authorization code and device grant alike.
- A replayed authorization code revokes the client session from its first redemption; 3sln.me keeps a 10-minute redeemed-code marker for this (provisional, 2026-10-23).
- Durations offered when approving an app with a code are in [approve a sign-in §7](approve-a-sign-in.md#7-lifetimes).

## Sign-off checkpoints

- [ ] **A3 — Account linking:** no silent merges; linking requires current-account proof plus explicit mailbox consent.
- [ ] **A4 — Recovery:** email recovery is configurable and entails recycled-mailbox risk; users may disable it after alternative enrollment.

| Review checkpoint | Reviewer/date/outcome |
| --- | --- |
| Passkey lifecycle and concurrent enrollment/removal evidence | Pending; real maintained-library tests implemented |
| Session-management authorization and immediate revocation | Pending; platform-independent tests implemented |

Reviewer fields record actual outcomes when available. No approval is fabricated.

## Primary references

- [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/): RP/origin binding and registration/assertion verification. Production libraries may support newer versions while retaining this baseline.
