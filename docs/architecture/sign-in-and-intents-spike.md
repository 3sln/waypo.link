# Web sign-in methods, sign-in emails and intents through sign-in — design spike

> **Group:** 3sln.me reference service (one Bindle change request, §7.1)
>
> **Status:** design spike, documentation only (2026-10-28, revised the same day). **Owner-approved decisions** are marked "(owner-approved 2026-10-28)". Sign-off: Reviewer owner; Date 2026-10-28; Outcome approved with modifications; recorded in DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer". **Everything else is provisional**, including the concrete email sign-in link protocol (§4), the method-removal process (§6.4) and the password removal plan (§6.3). The owner approved the direction for these, not the designs. Sign-off for the provisional parts: Reviewer ___ Date ___ Outcome ___. No code or spec was changed. Production release remains disabled.
>
> **Covers:** carrying a pending intent through passkey sign-in, shared sign-in from another device, account creation and email links; email states (unverified, verified, sign-in), their data model, lifecycle and abuse rules; the cross-device email sign-in link (helper page, same-browser recognition, tab-to-tab completion, copy-code fallback) and its security audit; the two web sign-in methods that remain once passwords are dropped (sign-in email, passkey) plus shared sign-in, the minimum safe configuration and how methods are removed; why passkeys could churn today and the rules and rotation path that prevent lockout.
>
> **Does not cover:** the recovery file (periodic reissue, questionnaire encryption, the file proof itself) and identity transfer between providers, which are designed in the [recovery and transfer spike](recovery-and-transfer-spike.md); this spike only states what it needs from them (§6.4, §9.3). App and bearer-token sign-in (OAuth code + PKCE, [device authorization](../spec/extensions/device-authorization.md)), which keep their own rules (§6.5). Intent kinds, consent and handoff themselves ([intents](../spec/extensions/intents.md)).

Input: the owner directions in DEVLOG "2026-10-28 — Owner directions: sign-in, intents through login, recovery file, identity transfer", and the owner decisions in DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer" (sign-in part). Code references are to HEAD d58305f. Hosts under `.example` are placeholders.

## 0. Owner decisions (2026-10-28)

Reviewer: owner. Date: 2026-10-28. Outcome: approved as stated, with the modifications below. Source: DEVLOG "2026-10-28 — Owner approvals and directions: rules effects, sign-in, recovery and transfer".

| Decision | Where applied | State |
| --- | --- | --- |
| "Sign-in email" is the name. An email is **unverified, verified or sign-in**; only a verified email can be toggled to a sign-in email. | SI-1, SI-2, §3.2, §3.3 | Owner-approved 2026-10-28 |
| Email sign-up is fast: **no passkey step** in the email flow. After a successful sign-up, a message in the user's queue says a passkey can be set up to make sign-in easier. | SI-6, §3.4 | Owner-approved 2026-10-28 |
| **New email sign-in link direction**: the flow stays on the original tab; the link opens a helper page in another tab; the link recognises whether the same browser created and opened it; if the tabs can talk securely the helper reports success and closes (or says it can be closed); otherwise it shows a code to copy into the original tab (TV plus phone). Needs a security audit and hardening. | §4 (protocol, provisional), §5 (audit, provisional) | Direction owner-approved 2026-10-28; protocol provisional |
| **Drop passwords.** | SI-13, §6.3 (removal plan, provisional) | Owner-approved 2026-10-28; plan provisional |
| Users can **remove sign-in methods** (for example drop a sign-in email in favour of a passkey) through a rigorous process, probably requiring the recovery file. | §6.4 (process, provisional) | Direction owner-approved 2026-10-28; process provisional |
| **All other recommendations** of the first revision of this spike. | SI-1 to SI-22 and Q1 to Q8 as they stood, except where the decisions above change them | Owner-approved 2026-10-28 |

Consequences for previously approved items, which this revision reconciles and flags rather than silently overriding:

- **SI-9** (intent sealed into the email challenge) and **CR-I4** were approved for a flow in which the link completes sign-in in a new tab. Under the new direction the original tab completes sign-in and still holds the intent, so sealing is no longer needed. This revision recommends withdrawing them (§2.2, new question N1). Until the owner answers, they stay approved but unscheduled.
- **SI-10** (another device carries the intent behind a "Not now" screen) and **Q5** become moot: the device that opens the link never receives a session or the intent (§4.2 EL-1). The flow cookie SI-10 introduced is reused as the same-browser marker (§4.3).
- **SI-6 step 4** ("a passkey is offered first") is replaced by the owner's no-passkey-step decision. **SI-19**'s conditional create is not invoked during sign-up.
- **SI-13** and **Q6** ("stop offering passwords, keep existing ones") are replaced by "drop passwords".
- **SI-4 and SI-12** remain approved; §6.4 adds the removal process within their limits.

## Summary of recommendations

1. **Call it a "sign-in email"** (owner-approved 2026-10-28). Each address on an account is **unverified, verified or sign-in**, and only a verified address can become a sign-in email (SI-1, SI-2, SI-23).
2. **One "Continue with email" entry point** with uniform responses (SI-5, owner-approved 2026-10-28).
3. **Email sign-up has no passkey step** (owner-approved 2026-10-28). A create-account link makes the address a sign-in email, the recovery file stays mandatory before activation (Q2, owner-approved), and after activation a host item in the account's queue suggests adding a passkey (SI-6).
4. **Intents stay in the original tab** for every method, including email links, because the email flow now completes in the original tab (SI-8, owner-approved; SI-9 recommended for withdrawal, N1).
5. **Cross-device email sign-in link** (direction owner-approved; protocol provisional, §4). The original tab holds a per-flow secret that never leaves it except at redemption; the browser holds an HttpOnly flow cookie; the email holds only an opaque, single-use, fragment-only token. The helper page **never creates a session by itself** (EL-1). In the same browser it approves the flow after an explicit confirmation, and the original tab, which polls the server (with a BroadcastChannel wake-up as a fast path), redeems it with its secret. On another device the helper shows a 6-digit code, created only after an explicit confirmation, which is useful only together with the original tab's secret.
6. **Hardening** (§5): GET does nothing and the helper's first request changes nothing, so link scanners cannot consume or authenticate. The helper shows the requesting device, approximate location and time and names the phishing ask outright. Codes are flow-bound and have a 5-try budget, BroadcastChannel messages are wake-ups only, and responses are uniform. Residual risks are stated in §5.4.
7. **Drop passwords** (owner-approved 2026-10-28). They are removed from sign-in, sign-up, step-up, shared-sign-in approval, recovery eligibility and transfer enrollment, with a destructive dev reset of password-only accounts (§6.3, provisional plan).
8. **A web account always has the recovery file plus at least one working passkey or sign-in email** (SI-12, owner-approved). **Removing a method** follows the tiered process in §6.4 (provisional). Undoing a method added in the last 7 days needs a passkey aged 7 days or more, or the recovery file. Removing an established method needs the recovery file plus a notified, cancellable delay. The method that will remain must have been proven in the same flow. Removals are blocked during the post-reissue 7-day gap.
9. **Passkey churn fixes** SI-14 to SI-22 are unchanged (owner-approved 2026-10-28).

## 1. Inventory: how it works today

### 1.1 Sign-in methods

| Method | Where | State |
| --- | --- | --- |
| Passkey | `IdentityService.beginPasskeyLogin` / `finishPasskeyLogin` (`packages/identity/service.mjs`), `packages/identity/webauthn.mjs` (SimpleWebAuthn 14.0.3) | Implemented. **Needs a handle first**: the `pl1.` begin token MACs `{handle, challenge, nonce, expiry}`, and finish looks the account up with `findByHandle(claim.h)`. Discoverable credentials are required at registration, but sign-in without a handle is not offered. |
| Password | `loginPassword`; `apps/worker/password.mjs`, `createArgon2Hasher` (`apps/node/server.mjs`); `setPendingPassword` route | Implemented (Argon2id). Offered at sign-up next to passkey. Also used for step-up, LA-7 approval, recovery-reissue eligibility (`packages/runtime/recovery-eligibility.mjs`), transfer enrollment (`packages/identity/transfer-enrollment.mjs`, PORT-6), the authority epoch (`authority-epoch.mjs`), owner channels (`owner-channels.mjs`) and the operator boot principal (`packages/identity/admin.mjs`). **To be dropped** (owner-approved 2026-10-28, §6.3). |
| Email link | `emailLoginStart` / `emailLoginConfirm`, mail in `apps/worker/email.mjs` (`/email/login#token=…`) | Implemented **for existing active accounts only**, and only when the owner has opted in (`emailLoginEnabled`, default `false`). Ten-minute single-use token of the form `<accountId>.<random>`. A GET does nothing and a confirming POST redeems it **in the tab that opened the link**. `{sent:true}` for every address. **No sign-up through an email link** ([account lifecycle](../3sln/accounts/account-lifecycle.md) says the implementation "does not claim … arbitrary-email account materialization", although the outcome table in [sign-in and sessions](../3sln/accounts/sign-in-and-sessions.md#3slnme-email-sign-in) has a row for it). |
| Shared sign-in (session handoff) | `LinkedApproval` `session` kind (`packages/identity/linked-approval.mjs`), legacy alias `DeviceLogin` (`/api/auth/device/*`), [approve a sign-in](../3sln/accounts/approve-a-sign-in.md) | The legacy QR or code flow runs without a flag. The LA routes sit behind `DEVICE_AUTHORIZATION_ENABLED` (off). Approving needs a passkey or password authentication within 5 minutes (LA-7). A session created by an email link or by recovery never counts. |
| Recovery file | `recover`, hosted recovery transaction | Implemented. Out of scope here (recovery and transfer spike). |

Browser sessions last at most 24 hours (`sessionTtlMs`), with up to five signed-in accounts per browser ([multi-account sessions](multi-account-sessions.md)).

### 1.2 Email handling

- **One address per account**: `account.verifiedEmail`, `emailVerifiedAt`, `emailLoginEnabled`, plus `previousEmails` (up to 8, kept 30 days for security notices and reissue cancellation). The repository keeps a unique index on the verified address (`findByEmail`). Comparison lowercases only the domain.
- **Three ways to verify an address**, and none of them enables sign-in:
  - an 8-digit code during sign-up (`setupEmailStart` / `setupEmailConfirm`, required in production because `SIGNUP_CONTACT_REQUIRED=true`), which sets `emailLoginEnabled=false`;
  - a link while signed in (`emailStart` / `emailConfirm`, `/email/confirm#token=`), bound to the session that asked for it; changing the address turns sign-in off;
  - an operator or system invitation that names a required address.
- **Sign-in is a separate opt-in** (`configureEmailLogin`: recent authentication, CSRF, security epoch raised). Turning it off clears pending login links. Removal (`emailRemove`, behind `EMAIL_REMOVAL_ENABLED`) clears both the address and the opt-in.
- **Tokens** are `<accountId>.<random>`, with a random UUID standing in for unknown addresses. They travel only in the URL fragment and are stored as hashes. Each link is bound to `emailVerifiedAt`, so changing the address invalidates it. *Note:* the account id in the token puts an internal identifier into the mailbox; §4.2 makes the new token opaque.
- **Rate limits** (`packages/core/abuse-policy.mjs`): per mailbox 5 per 15 minutes and 12 per 6 hours; 5,000 per hour per region; a global ceiling; Turnstile first. *Discrepancy:* [sign-in and sessions](../3sln/accounts/sign-in-and-sessions.md) still says "20 per day" and "2,000 per hour". The code and DEVLOG (review item 5) agree with each other, so the document is stale.
- **Recovery** clears `emailChallenges` but leaves `verifiedEmail` and `emailLoginEnabled` as they were (`service.mjs`, `recover`).

### 1.3 Passkey handling

- `registrationOptions`: `rpID` = `config.rpID` (the `RP_ID` setting, `3sln.me` in production and `localhost` locally), `userID` = UTF-8 of `account.id`, `userName` = `account.handle` (the canonical `n.` name), no `displayName`, attestation `none`, ES256 and RS256, `residentKey: required`, `userVerification: required`, and every existing credential in `excludeCredentials`.
- The constructor requires `origin.hostname === rpID`: one origin, which equals the RP ID. The policy text speaks of a "permitted HTTPS origin list", but the code has exactly one origin.
- Embedded ceremonies (`crossOrigin`, `topOrigin`) are refused.
- At most 5 credentials. Adding one (`credentialBegin` / `credentialFinish`) needs a passkey or password authentication within 15 minutes; email sessions never count (`authAt`). Removing one needs the recovery file to be configured and another passkey or a password to remain.
- Stored per credential: `id`, `publicKey`, `counter`, `transports`, `deviceType`, `backedUp`, `label`, `createdAt`. **Not stored:** when the credential was last used, or its AAGUID.
- **Counter:** SimpleWebAuthn throws when `(new > 0 || stored > 0) && new <= stored` (`verifyAuthenticationResponse.js:186`), and the service turns that into a generic `unauthorized`.
- **Recovery** sets `account.credentials = []` and `passwordHash = null` (`service.mjs`, `recover`).
- **No rotation concept**, and no use of the WebAuthn Signal API (`signalUnknownCredential`, `signalAllAcceptedCredentials`, `signalCurrentUserDetails`).

### 1.4 Intents when signed out

- `/i` (`packages/runtime/routes/intents.mjs`, `apps/web/src/intent.mjs`) checks bounds and encoding without reading any account, removes the value from the address bar, and shows a landing page when no session exists.
- **Sign in or sign up** (`SignInIntent`, `apps/web/src/bl/intent-flow.mjs`) saves `{value, placement, expires ≤ 1 h}` in `sessionStorage['3sln-intent-continuation']`. It then goes to `/console?signin=1&return_to=%2Fi`, which stores `{url:'/i', expiresAt: now + 10 min}` under `bindle.provider-continuation` (`apps/web/src/providers/browser.mjs`). The only return targets allowed are `/i` and the `/oauth/authorize?request_id=` pattern.
- **After sign-in**, `continueAuthorization()` returns to `/i`, which reads the saved value back. This runs after passkey or password sign-in and after shared sign-in (`accept`), after sign-up activation (`recovery/confirm`), and after redeeming an email link in the same tab (`ConfirmEmail`).
- With more than one signed-in account, `/i` asks the user to choose one explicitly before resolving the intent (`account-choice`).

### 1.5 Gaps against the directions

| Direction | Gap |
| --- | --- |
| Intents through sign-in | Works only in the same tab and only within 10 minutes. The console's continuation (10 min) expires before the intent's (1 h). **Email links lose the intent** because today they complete in the tab the link opens. |
| Email states | One address, a boolean opt-in, no unverified state on the account, and a code-verified sign-up email is never sign-in capable. |
| Email sign-up, no passkey step | Email-link sign-up does not exist. |
| Cross-device email link | Today's link completes sign-in wherever it is opened, so the link is a bearer credential. There is no same-browser recognition, no helper page and no code fallback for a TV. |
| Drop passwords | Passwords are offered at sign-up and are load-bearing in step-up, LA-7, recovery eligibility, transfer enrollment and operator boot (§1.1). |
| Remove sign-in methods | Only passkey removal exists (another passkey or a password must remain). Turning email sign-in off is a plain toggle with recent authentication; there is no tiered proof, delay or cancellation. |
| Passkey stability | See §7.1 (formerly §5.1). |

## 2. Intents through sign-in and sign-up

### 2.1 Where the value lives

| Option | Description | Verdict |
| --- | --- | --- |
| A. Value in the email link | The `bintent` value goes into the mailed URL's fragment. | **Rejected.** Intents §6 says the value is kept "never in a URL the provider generates", and security §Capability URLs forbids capability URLs in notification payloads. |
| B. Server-held record with its id in the link | A separate continuation record is referenced from the link. | Unneeded under §4. |
| C. Sealed into the email challenge | Approved in the first revision (SI-9). | **Recommended for withdrawal (N1).** Under §4 the original tab completes sign-in and still holds the value. |
| D. `localStorage` shared across tabs | Survives a new tab. | **Rejected.** It persists past the flow and conflicts with intents §6. |
| **E. Original tab's `sessionStorage` for every method (recommended)** | The email flow completes in the tab that started it (§4), so the SI-8 store covers email links as well. | **Recommended.** No server-side intent state, no URL, no change to intents §6. |

### 2.2 Decisions

- **SI-8 (owner-approved 2026-10-28). Keep the value in the browser for every sign-in.** The value stays in `sessionStorage` in the tab that started sign-in. This now covers email links too (§4.6). Changes:
  - (a) Merge `3sln-intent-continuation` and `bindle.provider-continuation` into one store whose expiry is the intent's (at most 1 hour from capture, never extended).
  - (b) Every path that completes sign-in calls one `resumeContinuation()`, including the email flow's redemption (§4.6).
  - (c) Completing a **recovery** discards any held intent and never resumes it.
  - (d) The approving device in a shared sign-in, and the device that opens an email link, never see the intent, and no server record is created for it.
- **SI-9 (owner-approved 2026-10-28; recommended for withdrawal, N1).** Sealing the intent into the email challenge with `CONTINUATION_KEY`. Under §4 it has no remaining use. The only case it would have served is an original tab that was closed before completion, and there the recommendation is to drop the intent and say so (§4.5). If the owner keeps SI-9, it applies only to that fallback and CR-I4 stays needed.
- **SI-10 (owner-approved 2026-10-28; superseded in part).** The `__Host-` flow cookie is kept and becomes the same-browser marker `B` (§4.3). Its other half, a second-device intent screen, is moot because the second device never receives a session (EL-1).
- **SI-11 (owner-approved 2026-10-28). What the user sees on return.** Unchanged: "Signed in as `<handle>`", then the ordinary `/i` flow. An account signed in from the intent flow counts as the explicit account choice. An email link always resolves to the account that owns the address, and the original tab shows "Continue as `<handle>`" after redemption. Switching the default account needs explicit acceptance, and accounts are never merged.

### 2.3 Security properties

| Concern | How it is met |
| --- | --- |
| Integrity | The value never leaves the original tab. `/i` revalidates it fully on resume. |
| Confidentiality | The value is never in a URL, an email, a server record or a log. The helper page has no access to it (another tab; `sessionStorage` is per tab). |
| Expiry | At most 1 hour from capture. If it has expired by redemption, the page says "The link you were opening expired; open it again", and sign-in still succeeds. |
| Open redirect | The continuation is never a URL. Return targets are a closed set (`/i`, `/oauth/authorize?request_id=`, `/approve`). |

## 3. Email states and sign-in emails

### 3.1 Name

**SI-1 (owner-approved 2026-10-28).** The user-facing term is "sign-in email". Settings show each address with its state. "Authoritative" stays only as the owner's working name in DEVLOG. (Alternatives considered in the first revision: authoritative, trusted, recovery, login email.)

### 3.2 States and data model (SI-2, SI-23)

**SI-23 (owner-approved 2026-10-28, state machine; field names provisional).** Every address on an account is in exactly one of three states:

| State | Meaning | Receives | Holds the uniqueness claim |
| --- | --- | --- | --- |
| `unverified` | Entered by the owner; a verification link is outstanding. | Only its own verification mail. | **No**: an unverified entry cannot squat an address, and verification fails if another account verified it first. |
| `verified` | Mailbox control proven at `verifiedAt`. | Security notices and, if chosen, ordinary notices. | Yes. |
| `sign-in` | A verified address the owner turned on for sign-in links. A full sign-in factor. | Sign-in links, plus everything `verified` receives. | Yes. |

Transitions:

```
(entered) ──verify──▶ unverified ──link or code──▶ verified ──turn on (SI-3)──▶ sign-in
    ▲                    │ expires 24 h / owner deletes         │                    │
    │                    ▼                                    delete             turn off or delete
    └──────────────── (gone)  ◀─────────────────────────────────┘◀── removal process (§6.4) ──┘
create-account link (§3.4): (none) ──▶ sign-in   (the link itself is the verification)
```

- Only `verified → sign-in` enables sign-in (owner decision). The create-account link verifies and enables in one step, because redeeming it proves mailbox control. The address is verified at that instant, which keeps the "only a verified address" rule.
- `sign-in → verified` (turning sign-in off) and deleting a `sign-in` address both remove a sign-in method, so both go through §6.4. Deleting a `verified` address keeps today's `emailRemove` rules (step-up, notices, `EMAIL_REMOVAL_ENABLED`).
- A hard bounce does not change the state. It adds `bounce` and stops sign-in mail (§7.4).

```
account.emails = [ {                       // at most 3 verified or sign-in entries, plus at most 1 unverified
  address,                                 // as entered; domain lowercased (existing rule)
  state: 'unverified'|'verified'|'sign-in',
  verifiedAt?,                             // ms; absent while unverified
  signInSince?: ms,                        // when state last became 'sign-in' (bound into every flow, §4.2)
  notices: boolean,                        // exactly one verified or sign-in entry is the notice address
  source: 'signup-link'|'setup-code'|'linked'|'invitation',
  addedBy: { session: 'passkey'|'email'|'email-cross-device'|'recovery'|'signup', at },   // for §6.4 Tier A
  lastSignInAt?: ms, bounce?: {kind:'hard'|'soft', at},
  pendingRemoval?: { requestedAt, effectiveAt, tier } } ]
account.previousEmails                     // unchanged (30-day notice and cancel channel)
```

- The unique index covers every `verified` or `sign-in` address in the same repository CAS. `unverified` entries are not indexed.
- **Migration:** destructive dev reset is acceptable. The small migration (`verifiedEmail` → `emails[0]` with `state = emailLoginEnabled ? 'sign-in' : 'verified'`) is kept anyway because it costs little.
- Flows bind `(address, signInSince)`: turning sign-in off and on again, or re-verifying, invalidates outstanding links.

### 3.3 How an address becomes a sign-in email (SI-3, owner-approved 2026-10-28)

| Path | Result |
| --- | --- |
| Account created from a create-account link (§3.4) | `sign-in` automatically. It is the only sign-in method at first. |
| Code verified during sign-up | `verified`. Sign-in is an **explicit, not preselected** choice on the same screen (Q3, owner-approved). |
| Added later while signed in | `unverified` → verify with the session-bound link → `verified` → turn on. Turning on needs a **credential step-up within 5 minutes**: a passkey, or for an account that can sign in only by email, a fresh sign-in flow to an *existing* sign-in email (SI-4). |

Every change to `sign-in` raises the security epoch and sends a notice to every channel.

### 3.4 Sign-up through an email link (SI-6, owner-approved 2026-10-28 as modified)

The sign-up runs on the **original tab** using the §4 flow with `purpose: 'sign-up'`. The helper page only proves mailbox control.

1. **Start.** "Continue with email" (§3.6) with an address that has no account while sign-up is open: the server creates a flow (§4.2) whose record holds the canonical address, the plan and the locale. No account exists yet.
2. **Helper.** The link opens the helper, which says "Create a 3sln.me account for `j•••@example.com`?" with the requesting device context (§4.4). It approves (same browser) or shows a code (other device).
3. **Original tab** redeems (§4.3). It then collects the current terms and the age attestation (same `ageAttestation` rules) and asks for explicit confirmation. The confirming POST reserves sign-up capacity (existing `signup-capacity` and waitlist rules) and, in one repository create, allocates the `n.` handle, creates the account as `pending` and claims the address as `sign-in`. A concurrent claim fails without merging.
4. **No passkey step** (owner decision). The only setup step is the recovery file, which stays mandatory before activation (Q2, owner-approved). The contact requirement is already met by the email. SI-19's conditional create is **not** invoked during sign-up.
5. **Activation** installs the session and calls `resumeContinuation()`.
6. **Post-sign-up passkey suggestion** (owner decision). Activation admits one host-attributed system item to the account's activity queue ([activity center](activity-center.md); system classification, not an app item): "Make signing in easier: add a passkey", opening Settings → Sign-in. It is informational, never modal, and expires when a passkey exists. It repeats at most once, after 30 days, if the account still has no passkey (folded into §7.4).

### 3.5 Sessions for an account that signs in only by email (SI-4, owner-approved 2026-10-28)

Unchanged. An email-flow session counts as recent authentication only for adding a passkey, verifying an extra address and turning sign-in on for another address. It never counts for removing a method, reissuing the recovery file, approving a shared sign-in or app grant, identity transfer or deletion. §6.4 adds one narrow exception: undoing a method that an email session added (RM-3), which is symmetric with SI-4. Sessions from the cross-device code path carry `source: 'email-cross-device'` (§4.3) so that policy can tell them apart (N2).

### 3.6 One entry point, uniform responses (SI-5, owner-approved 2026-10-28)

"Continue with email" replaces "Email me a sign-in link". After Turnstile and the existing mailbox, region and global windows, the server **always creates a flow, returns the same response shape** (§4.3 step 1) and does the same work. What gets mailed depends on the address:

| Address state | Mail | Flow |
| --- | --- | --- |
| A sign-in email of an active account | A sign-in link | Can complete |
| No account, sign-up open | A create-account link | Can complete (sign-up) |
| No account, sign-up closed or capacity reached | A notice with a waitlist link | Never completes |
| `verified` (not sign-in) on an account | A link-free notice ("This address is on a 3sln.me account but cannot receive sign-in links …"), at most one per 24 h | Never completes |
| `unverified` anywhere, or an account that is suspended, deleted, moved or recovering | Nothing | Never completes |

A flow that never completes polls `pending` until it expires, exactly like a completable flow the user never opened.

### 3.7 How an address stops being a sign-in email

- **The owner turns sign-in off or removes the address**, through §6.4. Refused if it would leave no working method (SI-12).
- **A recovery-file recovery sets every `sign-in` address to `verified`** (owner-approved). Recovery setup lists them so the recovering person can turn sign-in back on with a fresh flow.
- **Account deletion or a move** clears it.
- **A hard bounce** marks the address undeliverable and stops sign-in mail but does not change the state (§7.4).

### 3.8 Abuse summary

| Threat | Mitigation |
| --- | --- |
| Account enumeration | §3.6 uniform answers, flows and work; generic failures everywhere (§5.2). |
| Email takeover or recycled mailbox | A mailbox is a full factor only for `sign-in` addresses. Every email sign-in from a new browser sends a notice. Email sessions cannot remove established methods or reissue the file (SI-4, §6.4). |
| Link interception, scanners, forwarding | The link alone never creates a session (EL-1). §5.2. |
| Mail bombing | Existing mailbox windows (5 per 15 minutes, 12 per 6 hours) after Turnstile; link-free notice once per day. |
| Sign-up flooding | Capacity is reserved only at the confirming POST on the original tab. |
| Unverified squatting | `unverified` entries hold no uniqueness claim and expire after 24 h. |

## 4. Cross-device email sign-in link (protocol, provisional)

Owner direction (approved 2026-10-28): the flow stays on the original tab; the link opens a helper; same-browser recognition; secure tab-to-tab success, or a code to copy. This section is the provisional protocol.

### 4.1 Actors and secrets

| Name | Where it lives | Purpose | Never |
| --- | --- | --- | --- |
| **R**, the original tab | The tab where the user typed the address | Starts, polls, redeems; holds the intent | — |
| **H**, the helper page | `/email/link`, opened from the email in any browser | Shows the request, confirms, approves or reveals a code | Creates a session itself (EL-1) |
| `flowId` | Server record key; known to R | Names the flow for polling and redemption | In the email, in a URL, in logs in clear |
| `S`, the per-flow secret | Generated by R with `crypto.getRandomValues` (256 bits); kept in R's memory and `sessionStorage` (survives reload and tab discard) | Proves "I am the tab that started this flow" at redemption | In the email, in a cookie, in any URL, sent before redemption; the server stores only `SHA-256(S)` |
| `T`, the channel tag | `HMAC-SHA-256(S, "bindle-email-flow-bc")`, computed by R and sent at start | Authenticates BroadcastChannel wake-ups (§4.5) | Grants anything; it is a hint key only |
| `B`, the browser marker | `__Host-bindle_email_flow` cookie: 256-bit random, `Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=1200`; reused by concurrent flows in the same browser | Lets the server recognise that H runs in the browser that started the flow | Authenticates anyone; the server stores only a keyed hash |
| `L`, the link token | 256-bit random, in the email URL **fragment** only | Proves mailbox receipt | Holds an account id, flow id or address; the server stores only `HMAC(K_link, L)` as the lookup index |
| `C`, the transfer code | 6 decimal digits, created only at reveal (§4.4) | Carries mailbox approval from another device to R | Valid without `S`; stored other than as `HMAC(K_code, flowId‖C)` |

`SameSite=Strict` is enough. The navigation from the mail client to H's static document is cross-site and does not carry `B`, but H's same-origin `fetch` POSTs do, because their site for cookies is the top-level document's (3sln.me). Recognition therefore happens on H's POSTs, never on the GET.

### 4.2 Server-side flow record and invariants

```
EmailFlow {                                  // provider-wide store keyed by flowId; created on every start (§3.6)
  flowId, purpose: 'sign-in'|'sign-up'|'inert',
  accountId?, address?, signInSince?,        // bound for sign-in; address only for sign-up; absent when inert
  secretHash: SHA-256(S), channelTag: T,     // T is returned to H only after same-browser approval
  browserHash: HMAC(K_b, B),
  linkIndex: HMAC(K_link, L), linkGeneration,// "resend" re-mails a new L for the same flow and bumps the generation
  requester: { uaSummary, approxLocation, createdAt, networkPrefixHash },   // display only, never authority
  state: 'pending'|'approved-same-browser'|'code-revealed'|'redeemed'|'cancelled'|'locked'|'expired',
  codeHash?, codeExpiresAt?, codeAttempts: 0, reveals: 0, inspects: 0,
  securityEpochAtStart?, expiresAt: createdAt + 15 min, linkExpiresAt: sentAt + 10 min }
```

Invariants (EL-*):

- **EL-1. The link alone never yields a session anywhere.** A session is created only by (a) R presenting `S` (with `C` in the cross-device case), or (b) the same-browser fallback in §4.5, which needs `B` plus the link plus an explicit confirmation in a browser where R has gone away. A forwarded, scanned or intercepted link cannot sign anyone in on another device.
- **EL-2. GET never changes state.** `/email/link` is a static, cookie-independent, `no-store` document that reads `L` from the fragment and removes it from the address bar (`history.replaceState`).
- **EL-3. H's first request is read-only.** `inspect` returns the display context and changes only counters.
- **EL-4. Every state change needs an explicit user act** on a control that is inert until visible and focused for 600 ms, with no default focus.
- **EL-5. Single use, CAS-consumed.** Each transition is a compare-and-swap on the flow record. Redemption consumes the flow, `L`, `C` and `S` at once.
- **EL-6. Rebinding at redemption.** For sign-in, the account must still be `active`, the address must still be `sign-in` with the same `signInSince`, and the account's security epoch must not have risen since start (recovery, method removal, sign-in turned off). Otherwise redemption fails generically.
- **EL-7. Uniform shapes and timing.** Inert flows run the same code path, and every failure is one generic error per endpoint.
- **EL-8. No intent, return URL or account data is ever in the flow record**, except the account binding needed for EL-6.

### 4.3 Protocol

All endpoints are POST with a JSON body, an exact `Origin`, `Sec-Fetch-Site: same-origin`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

1. **Start (R).** R generates `S`, computes `SHA-256(S)` and `T`, and posts `/api/auth/email/flow/start {email, secretHash, channelTag, turnstileToken}`. The server runs Turnstile and the mailbox, region and global windows (§1.2), sets or refreshes `B`, creates the flow (an inert flow on non-mailing branches), mails in the background and returns `{flowId, expiresIn: 900, interval: 3}`. The response is identical in every branch. R shows "We sent a link to `j•••@example.com`. Open it on any device. Keep this tab open." with **Resend** (same flow, new `L`, older links dead) and **Cancel**.
2. **Mail.** `https://3sln.me/email/link#t=<L>`, with wording by purpose (sign-in, sign-up). The mail names no requesting device, which would be an attacker-chosen string in mail from 3sln.me. It says: "If you did not just ask to sign in, ignore this email. Nobody from 3sln.me will ever ask you for a code from it."
3. **Inspect (H).** H posts `/api/auth/email/link/inspect {t: L}`. It gets back, for a live link, `{purpose, handle (sign-in) or masked address (sign-up), requester: {uaSummary, approxLocation, createdAt}, sameBrowser: boolean, linkFlow}`, and for anything else `{invalid:true}` ("This link has expired or was already used. Ask for a new one on the device you are signing in to."). `sameBrowser` is `HMAC(K_b, B) == browserHash`. Inspect does not consume anything.
4. **H shows the request** (§4.4) and one explicit decision: **Yes, this is me** or **No, cancel it**. "No" posts `cancel`, which ends the flow; R shows "The request was cancelled from the email link", and a security notice goes out if it was a sign-in flow.
5. **Approve, same browser (H).** "Yes" posts `/api/auth/email/link/approve {t: L}`. The server rechecks `B` (it must match again) and moves the flow to `approved-same-browser` by CAS, consuming `L`. It returns `{channelTag: T}`. H posts the wake-up (§4.5) and closes, or says "Done. You can close this tab and return to the other one."
6. **Reveal, other device (H).** On a browser without a matching `B`, "Yes" posts `/api/auth/email/link/reveal {t: L}`. The first reveal creates `C`, stores its hash, sets `codeExpiresAt = now + 5 min` (capped at the flow's expiry) and moves the flow to `code-revealed`. Later reveals of the same link (at most 3) show the same `C`, so a scanner that clicks first does not burn the user's link, and `C` alone is useless (EL-1). H shows `C` in large digits with the warning in §4.4.
7. **Poll (R).** R posts `/api/auth/email/flow/status {flowId, secret: S}` every `interval` seconds, and immediately on a valid wake-up. Responses: `pending`, `approved` (same browser), `code` ("Enter the code shown on your other device"), `cancelled`, `expired`, `locked`. A wrong `S` or unknown `flowId` returns `expired`. Polling faster than `interval` returns `slow_down` (RFC 8628 §3.5 semantics), and R backs off. R also shows a code field from the start, so a user whose R missed the state change can type the code anyway.
8. **Redeem (R).** `/api/auth/email/flow/redeem {flowId, secret: S, code?: C, confirmed: true}`:
   - `approved-same-browser`: needs `S`.
   - `code-revealed`: needs `S` and `C`. Each wrong `C` increments `codeAttempts`; at 5 the flow is `locked` and R must start again.
   - EL-6 rechecks run. A sign-up flow returns a sign-up setup binding instead of a session (§3.4 step 3).
   - On success the server creates a **fresh** session (never derived from `flowId`, `S`, `B` or `C`; session-fixation safe), with `source: 'email'` or `'email-cross-device'`, sets the session cookies on this response under the multi-account rules (5-account cap checked at start and again here; replacing the default account needs explicit acceptance), consumes the flow and sends the sign-in notice.
   - R then calls `resumeContinuation()` (§4.6).
9. **Cancel (R).** Posts `cancel {flowId, secret: S}`. R cancels automatically when the user signs in another way, signs out or navigates away (`pagehide` with `navigator.sendBeacon`, best effort; expiry covers the rest).
10. **Retention.** Terminal flows are deleted after 24 h. The audit keeps `{flowId hash, purpose, outcome, sameBrowser, at}`, never `S`, `L`, `C`, `T`, `B` or an IP.

### 4.4 What H shows, and the copy-code fallback

- **Request card**, rendered from server-captured context, never from the URL: "**Sign in to 3sln.me as `n.2a…` (Ray)?** Requested from **Chrome on Windows**, **near Berlin, Germany**, **2 minutes ago**." It also says whether the request came from this browser: "This browser asked for this link", or **"Another device asked for this link."**
- **Approximate location** comes from the edge's coarse geo (city when the edge reports it with confidence, otherwise region or country), never an IP. The UA summary is the family and OS only. Both are labelled "approximate; a VPN can change it".
- **Different device**: before the decision, the card says in a highlighted box: "Only continue if **you** are signing in on that device right now and it is in front of you. If someone asked you for a code or to click this link, choose **No**." "Yes" then reveals:

  > **Your code: 482 917**
  > Type it on the device you are signing in to (Chrome on Windows). **Never read it out or send it to anyone**; 3sln.me will never ask for it. Expires in 5 minutes.

- **Code format**: 6 decimal digits, shown `482 917`, typed on R with or without the space. Digits suit a TV remote. Six digits suffice, where LA-3 needs 8 characters, because `C` is not a lookup key: it is checked only against the one flow named by `flowId` and only together with `S`, so a guess must come from the holder of `S` (that flow's own starter), is limited to 5 tries per flow, and can succeed only after the mailbox holder has revealed a code. The worst case is 5 / 10^6 per flow, bounded further by the mailbox windows (at most 48 flows a day per address): about 2.4 × 10^-4 a day against an address whose holder reveals every code, and 0 if they never do (N3).
- **Number matching was considered and not adopted** for the copy-code path. It relays a number from R to H. In the phishing case the attacker sits at R and simply tells the victim the number, so it adds friction without stopping consent phishing (§5.1 T3). The code already forces a human transfer from H to R. In the same-browser path there is no remote party to match against.

### 4.5 Tab-to-tab completion

| Channel | Works when the link opens in a new browsing context? | Verdict |
| --- | --- | --- |
| `window.opener.postMessage` | **No.** Links from mail apps open with no opener, and R's `COOP: same-origin` would sever it anyway. | Rejected. |
| `MessageChannel` | Needs an existing reference to transfer a port. None exists. | Rejected. |
| `BroadcastChannel` | Yes when R and H are in the same browser profile and storage partition (both first-party 3sln.me). Not across profiles, private windows, in-app mail browsers or devices. Any same-origin script can post. | **Fast path only**, authenticated, never authoritative. |
| `localStorage` `storage` event | Same reach as BroadcastChannel, but leaves data behind. | Rejected. |
| **Server-mediated status that R polls** | Always, any device. | **Authoritative channel.** |
| SSE or WebSocket on R | Always; lower latency. | Optional later (a Durable Object with hibernating sockets) if polling cost matters. Polling every 3 s for at most 15 min is ≤ 300 cheap requests per flow, charged to the flow's own budget. |

**BroadcastChannel wake-up.** Channel `bindle-email-flow`. After same-browser approval, H posts `{v:1, type:'approved', flowId, tag: T}`. R accepts a message only if `type` is known, `flowId` is its own and `tag` equals its own `T` (constant-time comparison). Its only effect is an immediate status poll. A forged or replayed message can therefore at most cause one extra poll. Success is always decided by the server at redemption with `S` (EL-1). `T` keeps unrelated same-origin pages and other 3sln.me tabs from triggering even that. A same-origin attacker able to read `T` has script execution in the origin and could read `S` anyway (§5.4 R5). H learns `T` only from the approve response.

**R gone, same browser.** If H's approval gets no `{type:'ack'}` from R on the channel within 2 s, H asks the server whether the flow was redeemed. If not, H offers **"The tab that asked for this is closed. Sign in in this tab instead?"** This is a separate explicit act, `/api/auth/email/link/complete-here {t}`, which needs `B` to match and the flow in `approved-same-browser`. It redeems into H's tab and consumes the flow. Any held intent is lost; H says "If you were opening a link, open it again". This is the only path where `S` is absent, and it still needs `B` (N8).

**Closing H.** H calls `window.close()`. HTML allows script to close a top-level context whose history holds one document, which is the usual case for a tab opened from a mail app. If H is still open 300 ms later, it shows "You can close this tab." H never navigates to the console.

### 4.6 Intent continuation on the original tab

R holds the SI-8 continuation throughout. After `redeem` returns, R calls `resumeContinuation()`. With an intent pending, that goes to `/i`, where the just-signed-in account is the explicit choice (SI-11), then the kind's disclosure, sender framing and armed controls. A sign-up flow resumes after activation (§3.4 step 5). If R reloads during the flow, `S`, `flowId` and the continuation come back from `sessionStorage`. If R is closed, the continuation is gone (§4.5 fallback). H never sees, stores or forwards the intent.

### 4.7 Rate limits and budgets

| Operation | Limits |
| --- | --- |
| start | Turnstile; existing mailbox (5 per 15 min, 12 per 6 h), region and global windows; at most 3 live flows per address and 3 per `B`; resend counts as a send |
| inspect | 10 per link; 30 per 10 min per network prefix (IPv4 /24, IPv6 /64) |
| approve, reveal, cancel | Once each per link; at most 3 reveals of the same code |
| status | `interval` 3 s, `slow_down` on excess; stops at expiry |
| redeem | 5 code attempts per flow, then `locked`; 20 failed redemptions per hour per network prefix; a **global failed-redemption budget** scaled to live `code-revealed` flows (the approach of device authorization §10.3), with Turnstile on R's redeem once it is exhausted |

## 5. Security audit of the email sign-in link (provisional)

### 5.1 Threat model

Assets: an account session; a newly created account bound to an address; the integrity of the original tab's intent. Attackers: (A1) a remote attacker who knows the victim's address; (A2) a passive or active reader of the victim's mail (forwarding, compromised mailbox, mail scanner); (A3) script in another same-origin tab or document; (A4) a cross-origin page in the victim's browser; (A5) a network attacker (out of scope under HTTPS and HSTS); (A6) someone who can briefly use the victim's unlocked device.

| # | Threat | Analysis | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| T1 | **Interception or forwarding of the email** (A2) | The link alone yields nothing elsewhere (EL-1). A reader can inspect it (learning the handle and requester context) and can reveal a code, but the code needs `S`, which only R holds. | EL-1; flow-bound `C`; 10-min link TTL; single-use approve; resend kills old links. | A reader who also starts the flow (that is, controls R) holds a full factor: mailbox control is a sign-in factor by definition for `sign-in` addresses (§3.8). Notices to other channels; SI-4 limits. |
| T2 | **Mail scanner pre-fetching or detonation** | GET is static (EL-2). Scanners that run JS make only the read-only inspect call (EL-3). A scanner that clicks "Yes" in a different browser reveals a code nobody uses. In a same-browser scanner (none in practice) `B` would not match. | EL-2 to EL-4; repeatable reveal (up to 3) so a scanner click does not burn the link. | A clicking scanner could cancel a flow by clicking "No" (denial of service; the user resends). Order the controls so neither is first in tab order, and put "No" behind a second confirmation ("Cancel the sign-in request?"). |
| T3 | **Cross-device consent phishing** (A1): the attacker starts a flow for the victim's address on the attacker's device, then persuades the victim, by phone, chat or a fake support page, to click the link and read out the code. | This is the classic pattern (device-code phishing). Our direction differs from RFC 8628: there the victim types an attacker-supplied code into a genuine page, which feels safe; here the victim must read a code *off* a 3sln.me page that says not to. | Device, location and time on the card; "Another device asked for this link" highlighted; explicit confirm; the code warning; mail wording; a sign-in notice to every channel with "This wasn't me", which revokes the session and starts an SI-4-limited lockdown; `email-cross-device` sessions marked for policy (N2). | **Real and not eliminable** for email as a factor: a determined social engineer can talk a victim through it. The location display is attacker-influenced (VPN into the victim's region). Passkeys (the post-sign-up suggestion, §3.4) are the phishing-resistant answer. |
| T4 | Phishing **page imitating H** to harvest codes | A fake H cannot produce a valid flow-bound code for the attacker's flow unless the victim reveals the genuine one. | The code is useful only to the holder of `S`; the mail is DMARC-aligned; H is only ever at `https://3sln.me/email/link`. | A fake page can still talk the victim into opening the genuine link and reading the code (that is T3). |
| T5 | **Session fixation** | Sessions are minted fresh at redeem; `flowId`, `S`, `B`, `C` never become session identifiers; session cookies are set only on R's redeem response (or H's `complete-here`). | §4.3 step 8. | None known. |
| T6 | **CSRF and login CSRF** (A4) | All endpoints need an exact `Origin`, `Sec-Fetch-Site: same-origin` and JSON. Signing the victim into the attacker's account would need the victim's R to hold the attacker's `S`. Typing an attacker-supplied code into the victim's R fails, because the code is bound to the attacker's flow. | Fetch Metadata and Origin; flow binding; multi-account acceptance before replacing the default. | None known. |
| T7 | **Clickjacking** of H or R | H and R are provider sign-in pages. | `frame-ancestors 'none'`, `X-Frame-Options: DENY`; controls inert until visible and focused for 600 ms (release gates §Popups); no default focus. | None known. |
| T8 | **Open redirect** | No endpoint takes a URL. H never navigates on success. R's continuation is the closed set. | §2.3. | None. |
| T9 | **Replay** | `L` is consumed at approve; a code is consumed at redeem; the flow is single-use by CAS; resend bumps `linkGeneration`. A replayed BroadcastChannel message causes only a poll. | EL-5. | None known. |
| T10 | **Brute force of codes** | §4.4: 5 per flow, only after reveal, only by the holder of `S`; plus prefix and global budgets. | §4.7. | ≤ 2.4 × 10^-4 a day per fully cooperative victim address, and only for that flow's starter, who is the T3 attacker anyway. |
| T11 | **Brute force of `L` or `flowId`** | 256-bit and 128-bit random values; a keyed-hash index for `L`. | — | None. |
| T12 | **Enumeration** | Every start creates a flow and returns the same response (§3.6). Polls of inert flows stay `pending`. Inspect returns one generic invalid response. Only the mailbox holder sees which mail was sent. | EL-7; mail sent in `waitUntil`; equal-work hashing on every branch. | Response-size or timing differences in the mail provider's acceptance are hidden by the background send. The mailbox holder learns that an account exists (accepted in the first revision). |
| T13 | **Timing** | Lookups by keyed hash; code and secret comparisons in constant time; inert branches do the same hashing and writes. | Timing-parity tests (§8.2 P3). | Platform jitter only. |
| T14 | **BroadcastChannel spoofing** (A3) | Any same-origin page can post. Messages carry no authority; `T` filters unrelated posters. | §4.5. | A3 with script execution can read `S` from R (R5). |
| T15 | **Cross-origin observation** (A4) | BroadcastChannel is origin-scoped; `B` is `__Host-` and `SameSite=Strict`; status needs `S`. | — | None known. |
| T16 | **Multiple accounts** | A flow binds one address and therefore one account. R shows "Continue as `<handle>`". The 5-account cap is checked at start and redeem. Redeeming for an account already signed in refreshes its session and still consumes the flow. Never merged. | SI-11; multi-account rules. | None. |
| T17 | **Logout and expiry races** | R signs out or signs in another way: R cancels. Sign-in turned off, address removed, recovery or method removal between start and redeem: EL-6 fails generically because the epoch or `signInSince` changed. A link opened after expiry: generic invalid. A code entered after `codeExpiresAt`: `expired`. A redeem racing a cancel: CAS, one wins. | EL-5, EL-6. | A user who signs out on R after H approved but before R redeemed loses the flow (intended). |
| T18 | **Someone at the victim's unlocked device** (A6) | They could open the mail and approve. That is equivalent to mailbox access. | Notices; SI-4 limits. | Accepted (same as any mailbox factor). |
| T19 | **In-app mail browsers and separate cookie jars** | H runs in a webview without `B`, so the same-browser path falls back to the code. | Correct degradation. | Usability: an extra code on one phone. Accepted. |
| T20 | **Attacker-chosen content in mail from 3sln.me** | The mail contains no requester-supplied text. The device and location appear only on H, as server-derived labels. | §4.3 step 2. | None. |
| T21 | **Accounts whose only method is sign-in email** | For them, T3 is full session takeover within SI-4's limits: no method removal (except RM-3 undo of email-added methods), no reissue, no approvals, no transfer, no deletion. An attacker can add a passkey (SI-4) for persistence. Notices go to every channel, and the owner can undo it with the recovery file (§6.4 RM-2) or, because an email session added it, with a sign-in email (RM-3). | §6.4; N2 proposes holding passkeys added from an `email-cross-device` session as provisional for 24 h. | Persistence until the owner notices. The recovery-reissue 7-day credential-age rule prevents a fast file takeover. |

### 5.2 Hardening checklist (folded into §4)

- Opaque, fragment-only, 256-bit link token with no embedded identifiers; removed from the address bar; `no-store`; `Referrer-Policy: no-referrer`; no third-party assets on H or R.
- GET inert; inspect read-only; every transition an explicit, delayed-arming user act; "No" behind a confirmation.
- Same-browser recognition only by the `__Host-`, HttpOnly, Strict marker `B`, checked on POSTs and checked again at approve; never IP or UA.
- Per-flow secret `S` generated in R and sent only at status and redeem; hashed at rest.
- Codes created only at reveal; flow-bound; 5 tries; 5-minute life; keyed hashes.
- BroadcastChannel as a tagged wake-up only; authority only at server redemption.
- Uniform start response, inert flows, generic failures, background mail.
- Rebinding checks at redemption (EL-6); fresh session minting; multi-account acceptance.
- Notices on every email sign-in from a new browser, with a requester summary and "This wasn't me".
- `frame-ancestors 'none'`, XFO DENY, COOP `same-origin` on R and H, a strict CSP with no inline script (limits A3).

### 5.3 Comparison with other cross-device patterns

| Pattern | Proof of proximity | Phishing resistance | Relevance |
| --- | --- | --- | --- |
| Classic magic link | None; the link is a bearer credential wherever it is opened | Low: forwarded or scanned links sign in | Today's implementation. §4 removes the bearer property (EL-1). |
| **RFC 8628 device authorization** | None; the user types the device's code on a verification page | Known weak: device-code phishing campaigns get victims to enter an attacker's code on the genuine page. RFC 8628 §5.4 itself warns about remote phishing. | Our code travels the other way (H → R), and the page that shows it tells the user never to share it. The same social-engineering residual remains (T3). Our [device authorization](../spec/extensions/device-authorization.md) §5.2 rule ("type the code unless alongside the device") matches EL-4's spirit. |
| **Passkey cross-device (hybrid, CTAP 2.2)** | Yes: a BLE advertisement proves the phone is near the client; the tunnel is end-to-end encrypted and origin-bound | High: the assertion is bound to the RP origin, so a remote phisher cannot relay it | Email cannot prove proximity or bind to an origin. This is the stated reason to steer users to passkeys after sign-up. |
| Push approval with number matching | None | Moderate: it stops blind fatigue approvals, not a social engineer who reads the number out | Considered and not adopted (§4.4). |

### 5.4 Residual risks (stated honestly)

- **R1. Consent phishing (T3)** remains possible against a cooperative victim. Mitigated by warnings, context, the direction of the code and notices, not prevented. Passkeys are the remedy.
- **R2. Mailbox compromise** gives a full factor for `sign-in` addresses (by design). Limited by SI-4, notices and §6.4.
- **R3. Location and UA labels** are approximate and attacker-influenced. They help users notice anomalies but are not evidence.
- **R4. Scanner denial of service**: a scanner that cancels or reveals can force a resend.
- **R5. Same-origin script execution (XSS)** defeats the flow, since it can read `S` from R or drive H. Mitigated only by the origin's CSP and code hygiene, as for every other sign-in path.
- **R6. Email delivery** is a configured external service. Local tests prove the protocol, not delivery or provider behaviour.
- **R7. TV sign-up** cannot meet the recovery-file gate if the device cannot save a file (N4).

## 6. Sign-in methods

### 6.1 Methods

| Method | Set up | Shown and managed | Notes |
| --- | --- | --- | --- |
| **Sign-in email** | Automatically at email sign-up, or verified and turned on (§3.3) | Settings → Sign-in: each address with its state, when it was verified, its last sign-in, undeliverable status, any pending removal | A full sign-in factor, and the page says so. |
| **Passkey** | After sign-up from the queue suggestion (§3.4), after a later email sign-in (conditional create, SI-19), or in Settings | Label, synced or device-only, created, last used; rename; remove (§6.4) | Sign-in without a handle (SI-16). |
| **Shared sign-in from another device** | Nothing to set up: any signed-in device with a passkey authentication within 5 minutes (LA-7, now passkey only) | Requesting device shows its code; approving device enters it at `/approve` | Email-only accounts cannot approve; they use the email flow on the new device (§4). |

### 6.2 Minimum safe configuration (SI-12, owner-approved 2026-10-28)

- **Hard floor, enforced by the server:** an active web account has the recovery file **and** at least one **working** sign-in method, meaning a passkey that is not suspended, or a `sign-in` email that is not undeliverable. Passwords no longer count (§6.3). Pending removals count as already removed when the floor is checked, so two concurrent removals cannot both pass.
- **Recommended, shown as "at risk" until met (§7.4):** two independent methods besides the file.

### 6.3 Dropping passwords (SI-13, owner-approved 2026-10-28; plan provisional)

**Scope.** Passwords are removed as a user-account method everywhere they appear:

| Area | Change |
| --- | --- |
| Sign-up (`setPendingPassword`, `/api/auth/password/pending`) | Removed. Sign-up is email (§3.4) or passkey. |
| Sign-in (`loginPassword`, `/api/auth/login/password`) | Removed. The route returns 404 (no special "passwords retired" oracle on an unauthenticated route). |
| Step-up and recent authentication (`recent`, `authorized`) | Passkey, or the SI-4 email step-up for its narrow list. |
| Shared-sign-in approval (LA-7) and the approve page | Passkey only. |
| Recovery reissue eligibility (`recovery-eligibility.mjs`) | Credential age from passkeys only. An email-only account must add a passkey and wait 7 days to reissue (SI-4 already forbids email-session reissue). **Cross-spike item:** the recovery spike's "previous file can only cancel, and only after a password-authorized reissue" rule needs restating without passwords (§9.3). |
| Transfer enrollment (PORT-6, `transfer-enrollment.mjs`) | Password enrollment removed. Passkey enrollment (already provisional) or an email flow to the arriving person's address. |
| Authority epoch, owner channels, export contributors, lifecycle tombstone | Drop `password` credential kinds, `passwordHash`, `passwordSetAt`. |
| Hashers (`apps/worker/password.mjs`, `createArgon2Hasher` in `apps/node/server.mjs`, `packages/identity/crypto.mjs`) | Removed with their dependency, if nothing else uses them. |
| Operator boot principal (`admin.mjs` `method: 'password'`) | Separate operator surface. Recommendation N5: passkey only as well. |
| Docs | sign-in and sessions, account lifecycle, approve a sign-in (LA-7 and §4 text "fresh passkey or password"), release gates rows. |

**Migration (destructive dev reset is acceptable; no real users).**

1. One deploy, ideally the same reset window as the recovery spike's v3 migration, so accounts are reset once.
2. Accounts with a passkey or a sign-in email: delete `passwordHash` and `passwordSetAt`, raise the security epoch, and revoke sessions whose step-up was a password.
3. Accounts whose only method was a password: **reset** (delete) in development. No in-place conversion path is built, since there are no users to convert.
4. Delete all `pending` sign-ups that chose a password.
5. Remove the code, routes, tests and fixtures. `npm test` then runs with no password paths. Record the reset in DEVLOG when it is done (destructive cleanup is logged).

### 6.4 Removing sign-in methods (direction owner-approved 2026-10-28; process provisional)

**Goals.** The owner can drop a method (for example a sign-in email in favour of a passkey). An attacker holding one factor cannot strip the owner's other factors quickly. The account never ends with no working method.

**Definitions.** *Established method*: a passkey or sign-in email that has existed for at least 7 days. *Recent method*: under 7 days old. *Proven remaining method*: a method that will remain and has been exercised in this removal flow (a fresh passkey assertion, or a fresh email round trip to that address within 10 minutes). *File proof*: a server-verified presentation of the **current** recovery file's secret in a proof-only mode that starts no recovery. The recovery spike defines it (§9.3); the owner's "proof of download" hash re-upload proves only that the encrypted file was saved, not that it can be opened, so it does **not** qualify.

| Rule | Removal | Proof | Delay and notices |
| --- | --- | --- | --- |
| **RM-1. Floor** | Any | Refused if it would leave no working method, counting pending removals (SI-12). A proven remaining method is always required. | — |
| **RM-2. Tier A: undo a recent method** | A recent passkey or sign-in email | A fresh passkey assertion (≤ 5 min) from an **established** passkey, **or** file proof | Immediate. Notice to every channel, including the removed address. |
| **RM-3. Undo by email of an email-added method** | A recent method whose `addedBy.session` was `email` or `email-cross-device` | A fresh email-flow session from any established sign-in email (the narrow SI-4 exception: the factor that could add it can undo it) | Immediate. Notice to every channel. It cannot remove anything added through a passkey or the file. |
| **RM-4. Tier B: remove an established method** | An established passkey, or turning off or deleting an established sign-in email | **File proof**, plus a fresh assertion from an established passkey if the account has one other than the method being removed | **24 h** delay with a passkey assertion, otherwise **72 h**. Notices at request and at effect to every channel, including the method being removed and `previousEmails`. |
| **RM-5. Cancel** | A pending Tier B removal | Any one of: a passkey sign-in with the method being removed; a cancel-only link mailed to a sign-in email being removed; any session created before the request whose last authentication was a passkey; file proof | Immediate. Cancelling raises the security epoch and sends a notice. |
| **RM-6. During a pending removal** | — | The method keeps working. A recovery reissue cannot begin (a begin cancels nothing; it is refused with "finish or cancel the pending sign-in change first"). Transfer cannot start. A second Tier B removal is allowed only if RM-1 holds with both counted. | — |
| **RM-7. Reissue gap** | Tier B, and file proof generally | **Refused** while a reissue is pending and for 7 days after a reissue confirmation or a completed recovery. That 7-day no-recovery gap (recovery spike §4.2, Q4) exists so that a file obtained by a session-holding attacker cannot act at once. Allowing it to authorize removals would reopen that hole. Tier A with a passkey and RM-3 remain available during the gap. | — |
| **RM-8. Recovery interaction** | — | A completed recovery cancels every pending removal (the recovering person reconfigures). SI-17 (keep proven passkeys) and §3.7 (sign-in emails become `verified`) already strip attacker additions. | — |
| **RM-9. Effects** | On effect | One CAS: remove or downgrade the method, clear its outstanding flows and links, raise the security epoch, revoke sessions whose authentication used it, call `signalUnknownCredential` (passkeys) or update the email index, and audit. | — |

Worked cases:

- *Drop a sign-in email in favour of a passkey (the owner's example).* The account has passkey P (established) and email E (established). The user asserts with P (P is the proven remaining method), presents file proof, and E is downgraded to `verified` (or deleted) after 24 h, with notices to E and the other channels and a cancel link to E.
- *Attacker with the mailbox added passkey X yesterday.* The owner removes X immediately by RM-2 (their established passkey, or the file) or RM-3 (their sign-in email).
- *Attacker with a session tries to remove the owner's established passkey.* They need file proof (RM-4), and cannot use a freshly reissued file during the gap (RM-7). Any later attempt is delayed 24 to 72 h, with notices and cancellation from the passkey itself.
- *Email-only account wants a different address.* Add and verify the new address, turn sign-in on (SI-3 email step-up), then remove the old one: file proof plus a 72 h delay (no passkey), with the new address proven by a fresh round trip.

### 6.5 Out of scope: bearer-token and app sign-in

Unchanged from the first revision: app sign-in (OAuth code + PKCE, popup or FedCM, the device authorization grant, DPoP refresh) authenticates the person with these methods on provider pages. An email link opened while an authorization entry is pending carries no authorization context; the original tab keeps it, as for intents (§4.6).

## 7. Passkey stability (owner-approved 2026-10-28)

SI-14 to SI-22 and the §5.1 cause table of the first revision are approved and unchanged, except as noted.

### 7.1 Concrete churn and lockout causes in code

| # | Cause | Where | Effect |
| --- | --- | --- | --- |
| C1 | **Recovery deletes every passkey** | `recover`: `account.credentials = []` | Every passkey the person still holds stops working. |
| C2 | **Abandoned or retried sign-ups** | `signup`: new `account.id`; pending accounts expire after 30 minutes | Orphan passkeys for burned `n.` names. Less frequent now that email sign-up has no passkey step (§3.4). |
| C3 | **Counter regression locks a credential out** | SimpleWebAuthn `counter <= stored` | A device-bound key becomes unusable with no explanation. |
| C4 | **No Signal API** | `apps/web/src/providers/browser.mjs` | Removed or replaced credentials stay in managers. |
| C5 | **Handle required; opaque manager name** | `beginPasskeyLogin` (`h`); no `displayName` | A user who forgets `n.2a…` is locked out. |
| C6 | **RP ID tied to one exact origin** | constructor `origin.hostname === rpID` | A move would invalidate every passkey. |
| C7 | **No per-credential last use** | credential record | No "unused passkey" signal. |
| C8 | **Five-credential cap** | `credentialBegin` | Users of device-only keys must remove one to add one. |
| (C9) | Identity transfer | — | Recovery and transfer spike. |

### 7.2 Rules (SI-14 to SI-21)

- **SI-14.** The RP ID is fixed forever at `3sln.me`; extra origins through an `expectedOrigin` array; Related Origin Requests before any move; startup fails closed if `RP_ID` changes on a deployment with accounts.
- **SI-15.** `user.id` is `account.id` forever; sign-up retries reuse the pending account; orphans are reported with `signalUnknownCredential`.
- **SI-16.** Sign-in without a handle (conditional mediation); the handle is an optional hint.
- **SI-17.** Recovery suspends passkeys and keeps the ones the recovering person proves.
- **SI-18.** Counters are evidence, not a gate, for synced credentials; a device-bound regression gets a specific message and a notice.
- **SI-19.** Signal API after each sign-in; conditional create after an email sign-in, **but not during the sign-up flow** (owner's no-passkey-step decision). "After a password sign-in" no longer applies.
- **SI-20.** Record `lastUsedAt` (throttled daily) and `aaguid` (grouping only).
- **SI-21.** Never delete the last working method; never delete a credential except by SI-17 activation, an explicit owner removal (§6.4) or rotation (SI-22).

### 7.3 Rotation path (SI-22)

Unchanged: offer early (≥ 90 days ahead, at once for a lost device); overlap (the old credential becomes `retiring` only after the new one signs in, then works ≥ 30 more days); the owner confirms retirement, or it is automatic after the overlap if another method was used in 90 days, never the last; signal afterwards. Removing a `retiring` credential through rotation counts as an owner removal, and RM-1 applies.

### 7.4 "At risk of lockout" signals

As in the first revision (only one method besides the file; only device-only passkeys; every passkey unused 180 days and no sign-in email; an undeliverable or 12-month-silent sign-in email; a counter anomaly; a `retiring` passkey with an unused replacement; a recovery-file status). Additions:

- no passkey at all (the §3.4 queue item, repeated at most once after 30 days);
- a pending Tier B removal (shown with its effective time and Cancel).

## 8. Spec impact, phases and open questions

### 8.1 Spec impact

| Document | Tree | Change |
| --- | --- | --- |
| [intents](../spec/extensions/intents.md) §6 | **Bindle** | **CR-I4: recommended for withdrawal (N1).** With the email flow completing on the original tab, intents §6 ("the page or session-scoped browser storage") already covers every path. If the owner keeps SI-9, CR-I4 stays as drafted in the first revision. |
| [security](../spec/security.md), [auth](../spec/auth.md) | Bindle | None: provider sign-in is provider policy. |
| [sign-in and sessions](../3sln/accounts/sign-in-and-sessions.md) | 3sln.me | Rewrite the email section for the three states, "Continue with email", the §4 flow (helper, same-browser marker, code fallback, EL-1), SI-4 and RM rules, and passwords removed. Fix the stale rate-limit numbers. Passkey section to SI-14 to SI-22. |
| [account lifecycle](../3sln/accounts/account-lifecycle.md) | 3sln.me | Email-link sign-up supersedes the "does not claim arbitrary-email account materialization" sentence. No passkey step; the queue suggestion. Password sign-up removed. |
| [approve a sign-in](../3sln/accounts/approve-a-sign-in.md) | 3sln.me | LA-7 and the approve page become passkey only. Email-only accounts cannot approve (stated). The intent stays in the requesting tab. |
| [intent links](intent-links.md) | 3sln.me architecture | Point the landing's "Sign in or sign up" at SI-8 and §4.6. |
| [release gates](../3sln/release-gates.md) | 3sln.me | Rows: EL-1 (a link opened elsewhere never signs in); GET and inspect inert under a JS-executing scanner; same-browser approve and BroadcastChannel wake-up in Chromium, Firefox and WebKit; the in-app-browser fallback to a code; code attempt lockout and global budget; uniform start and inert flows (timing and size parity); EL-6 races; the RM tiers, delays, cancellation and the RM-7 gap; no password route reachable. |
| Recovery and transfer spike | 3sln.me architecture | Not edited here. Needs: a proof-only file presentation for RM-2, RM-4 and RM-5; restating "password-authorized reissue" without passwords; reissue refused during a pending removal (RM-6) (§9.3). |

### 8.2 Phases (flags off, engine-level tests first)

1. **P0, documents.** Owner answers to N1 to N8; sign-in-and-sessions stale text fixed; recovery-spike reconciliation (§9.3).
2. **P1, continuation unification (SI-8, SI-11).** Client only. Engine tests for each completion path, expiry and recovery discard.
3. **P2, email states and password removal (SI-1 to SI-3, SI-12, SI-13, SI-23).** `emails[]` with three states; settings UI; recovery downgrading `sign-in` to `verified`; floor check; **password removal and the destructive reset** (§6.3), sequenced with the recovery v3 reset if possible. Seeded chaos tests over concurrent claim, verification racing another account, and turning sign-in on and off.
4. **P3, email flow and email sign-up (SI-5, SI-6, §4)**, behind `EMAIL_SIGNUP_ENABLED` and a new `EMAIL_FLOW_V2` (the old `emailLoginStart` / `Confirm` removed when it lands). Engine-level flow state machine with seeded chaos over approve, reveal, redeem, cancel, resend, expiry, EL-6 rebinding and concurrent flows; uniform-work tests; the queue item; mail templates. Browser verification (DOM): H and R in two tabs with BroadcastChannel, a closed-R fallback, `window.close()` behaviour, a webview without `B`. Delivery is an external service; local tests do not show delivery.
5. **P4, method removal (§6.4).** Tier A, RM-3 and RM-1 first (they need no file proof). Tier B, RM-5 and RM-7 after the recovery spike's proof-only presentation exists. Chaos tests over concurrent removals, a removal racing a reissue, a recovery and a sign-in.
6. **P5, passkey stability (SI-14 to SI-21).** Real browser and authenticator evidence is separate release evidence.
7. **P6, rotation and health (SI-22, §7.4).**

### 8.3 Questions already answered (owner-approved 2026-10-28)

Q1 sign-in email; Q2 recovery file before activation; Q3 explicit, not preselected; Q4 up to 3 verified addresses, one notice address; Q7 keep proven passkeys at recovery; Q8 an email session may add a passkey, never remove. Q5 is moot under §4 (EL-1). Q6 is replaced by "drop passwords".

### 8.4 New open owner questions (each with a recommended answer)

| # | Question | Recommendation |
| --- | --- | --- |
| N1 | Withdraw SI-9 (intent sealed into the email challenge) and CR-I4, now that the original tab completes sign-in and holds the intent? | **Yes.** The only case it serves is an original tab that was closed (§4.5), where dropping the intent with a clear message is simpler and avoids a server-held capability. |
| N2 | Should sessions from the cross-device code path (`email-cross-device`) be narrower than SI-4? | **Yes, slightly:** they may add a passkey (the post-sign-up goal needs that on a new laptop), but such a passkey is `provisional` for 24 h. It signs in, cannot satisfy LA-7 or count as established, and its addition notice offers RM-3 undo. Turning sign-in on for another address is not allowed from such a session. |
| N3 | Code format for the copy-code fallback: 6 digits instead of LA-3's 8-character base-20 code? | **6 digits.** The code is flow-bound and needs `S`, it is not a lookup key, so LA-3's entropy requirement does not apply. Digits suit TV remotes (§4.4). |
| N4 | Email sign-up from a device that cannot save the recovery file (for example a TV)? | **Sign-in works there, sign-up does not complete there.** R explains "Finish creating your account on a device that can save a file", and the user restarts on a phone or computer. Moving the file download to the helper device would split one setup across two devices and weaken the activation gate. |
| N5 | Drop passwords from the operator boot principal (`admin.mjs`) too? | **Yes, passkey only.** Console unlock already needs a passkey stamp; keeping a password there only for boot leaves a phishable path on the most privileged account. Keep a documented break-glass that is not a password (the existing boot token flow). |
| N6 | The removal process depends on a proof-only recovery-file presentation from the recovery spike. Until it exists, ship only Tier A and RM-3? | **Yes.** Without file proof, established methods cannot be removed (a stricter interim, not a weaker one). |
| N7 | Show the requester's approximate location on H (city or region from edge geo)? | **Yes, at city or region granularity, labelled approximate, never the IP.** It is shown only to the mailbox holder of a flow aimed at their address, and it is the main phishing tell. |
| N8 | Allow the same-browser "R is closed, sign in here instead" fallback on H? | **Yes**, only with a matching `B`, an approved flow, a separate explicit act, and the intent dropped. It is the one path without `S`, and `B` limits it to the browser that started the flow. |

## 9. Reconciliation notes

### 9.1 With the first revision

Every SI rule keeps its number. SI-9 and CR-I4 await N1. SI-10 is reduced to the browser marker. SI-6 step 4 and SI-13 are replaced by owner decisions. SI-19 is narrowed (not during sign-up; no password case). §5 of the first revision became §7.

### 9.2 With code (HEAD d58305f)

Not implemented: the three states, the §4 flow, the RM rules and password removal. The existing `emailLoginStart` / `emailLoginConfirm` remain the implemented email sign-in until P3, and their token format (`<accountId>.<random>`) is superseded by the opaque `L`.

### 9.3 With the recovery and transfer spike (not edited here)

Needed from that spike: (a) a proof-only presentation of the current file (RM-2, RM-4, RM-5); (b) the "password-authorized reissue" cancel rule restated without passwords, probably as "passkey-authorized"; (c) reissue begin refused while a Tier B removal is pending (RM-6), and the removal block during the post-reissue gap (RM-7) made consistent with its Q4 answer. Until those are agreed, §6.4 Tier B stays unscheduled (N6).
