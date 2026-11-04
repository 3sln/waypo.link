# Admission, bootstrap and administration

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

2026-11-02. Owner selects private self-host enrollment, separate admin/user apps and PWAs, ordinary identities with granular grants, multiple policy authorities, temporary bootstrap login and durable service principals. Flow mechanisms and numerical limits remain provisional; no implementation is claimed. See [requirements](../requirements.md).

## Admission and bootstrap

Account admission supports closed, invite-only and explicitly enabled public modes. No upstream login, transfer/import, email or passkey path may bypass the selected mode. Closed signup does not disable existing-account login/recovery or registrationless app consent. Account-enrollment invitations are issuer-bound, bounded, revocable and atomically consumed; they confer neither administrator rights nor app consent.

Candidate bootstrap flow:

1. Before initialization expose only minimal setup/health surfaces. The administration app creates a nonextractable browser signing key and displays its fingerprint. Arriving first reserves nothing.
2. An operator approves that fingerprint through trusted deployment configuration, with an explicit absolute deadline and fresh generation. Missing/overlong deadlines are rejected; restart cannot restart the clock. Candidate default 30 minutes, hard maximum one hour.
3. Browser proves possession over a fresh one-use challenge bound to issuer, generation and setup transaction. Atomic consumption issues only a narrow temporary bootstrap login, not an account or permanent administrator. Candidate challenge two minutes, session 15 minutes bounded by approval expiry; no refresh/sliding extension. Every operation checks generation/deadline.
4. Separately enroll/invite the first administrator, explicitly assign grants and verify a passkey with user verification. Bootstrap may perform only essential setup/enrollment, never general user-data access. Successful handoff immediately ends bootstrap and invalidates its outstanding invitations. Interrupted retries cannot mint multiple independent sessions.
5. Remove temporary configuration/key material. Stale config, account deletion, restart and restore cannot reopen setup. Lost setup authority requires deliberate deployment recovery, not a public fallback.

Subsequent staff invitations require fresh authentication and current delegation authority, bind the intended role/scope/issuer/expiry, and fail after issuer revocation. Existing identities may accept without duplicate accounts. A passkey may sync and verifies an authenticator user, not a unique physical device/human; compromised same-origin script can invoke a nonextractable key.

## Admin application and live grants

Admin uses normal identity login through a dedicated client/session and live capability access list bound to the verified exact issuer/subject observed for that admin client. Handles/email are lookup hints, not authority; pairwise subjects from other apps are not interchangeable. Ordinary app tokens and bootstrap credentials cannot authorize normal admin operations. Fresh verification protects sensitive actions.

Configure canonical admin origins/paths; never infer them from untrusted forwarded headers. Prefer separate origin with host-only secure cookies, exact-origin/CSRF checks and no wildcard credentialed CORS. A subpath remains supported but shares the origin's compromise/storage risks; cookie paths do not isolate apps. Separate PWA identities, service-worker scopes and cache names; never cache authenticated admin responses or credentials for offline use.

Capabilities deny by default and specify action/resource scope. Grant management has an explicit delegation ceiling and protected targets, preventing self-promotion, peer removal, batch bypass and indirect takeover. Operational access does not imply access to user content, recovery or impersonation. Grant removal invalidates already logged-in authority at the API, not just UI navigation.

Owner requires multiple policy authorities represented by ordinary identities with grants. Candidate protected-change quorum: founding single authority, two-of-two after adding a second, thereafter strict majority with minimum two; three authorities tolerate one member's loss. Distinct users approve a revision-bound expiring proposal. These thresholds are proposals, not approved constants. Ordinary delegated staff offboarding can remain immediate within subordinate scope. Protected changes include indirect takeover through suspension/deletion, recovery, authenticator changes or delegation editing. Two-authority deadlock needs explicit audited deployment recovery. Do not invent a universal administrator bypass.

## Automation

Personal tokens intersect fixed token scope, current user grants and installation policy; disabling/demoting the user restricts them. Durable automation defaults to installation-owned service principals with independent grants. Its immutable creator is an audit fact; creator departure does not break the service credential.

Issuance/rotation checks explicit management rights and delegation ceilings. Effective authority intersects fixed credential scopes, current principal grants and deployment policy. Later principal promotion does not enlarge an existing token. Initial automation excludes token minting, access-policy edits, recovery/authenticator establishment and impersonation. Use bounded expiry, revocation, digest-only secret storage and secret-free audit; opaque HTTPS Authorization credentials are a candidate implementation.

Maintain inventory, purpose, maintainers, scopes, expiry and rotation notices. Reassign maintainers during offboarding and review potentially exposed secrets separately. Disabling the service principal revokes its authority immediately. Staff departure is not automatically a compromise or a reason to destroy unrelated automation.

## Required evidence

Engine merge gates: all enrollment paths, one-use/concurrent/expired/revoked invitations, unapproved setup, binding/replay, deadline/generation/restart/restore, no automatic promotion, handoff revocation, grant/delegation/quorum bypasses, personal demotion, creator-independent service continuity and principal revocation. Release browser/e2e gates: durable fresh installation, real WebAuthn setup, independent-client consent, normal admin login, denied ordinary user, both origin/path configurations, PWA scopes and constrained credential creation/use/rotation/revocation.
