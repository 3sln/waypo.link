# Cooperative account porting

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

Design candidates, 2026-11-02. Not implemented or advertised. The owner prefers cooperative movement between provider accounts over a globally self-minted identity. This remains independent from copying app documents, transferring subscriptions or moving staff privileges.

OIDC identifies an account by the issuer and subject together. Its issuer is a case-sensitive HTTPS identifier and can contain a port/path; an email address is not an interchangeable identity key. Our current pairwise subjects remain appropriate. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).

There is existing specification work: the OpenID Account Porting draft describes user-approved authorization from a new provider to an old provider, then app-specific confirmation by the old provider when an app first sees the new identity. It protects pairwise subjects and describes a removal signal. Its trust and client-credential expectations need assessment against our registrationless public-client profile; it is not a drop-in final standard. The Foundation lists it as a draft. [Porting draft](https://openid.net/specs/openid-connect-account-porting-1_0.html), [Foundation specification catalogue](https://openid.net/developers/specs/).

## Candidate A: app-managed linking through existing OIDC

1. In a participating app, the user chooses to move or link their login.
2. The app requires fresh authentication of the current provider account, then starts a separate state/nonce/PKCE-bound login at the chosen new provider.
3. The app shows both verified identities and asks for explicit confirmation. It refuses silent merging into an already occupied app account.
4. The app records the new issuer/subject as a permitted identity for that app account. Removing the old login is a separate explicit choice with a working-new-login check.
5. Other apps remain unchanged until the user links them too. App-private data migration is offered separately, with source/target permissions and quota checks.

This uses the standards already implemented and works with ordinary external OIDC providers. It requires participating apps to implement linking and repeats the interaction per app. It must not treat a stale app session, matching email, arbitrary `login_hint`, or a claim made only by the destination provider as proof of source ownership.

## Candidate B: provider-assisted app-specific porting

1. The user signs in at the destination and starts a port from a selected source provider.
2. The source requires fresh authentication, clearly identifies the destination, and asks for porting consent. A purpose/audience-bound capability records the approved source/destination relationship.
3. On later login to a participating app, the destination presents app-specific porting evidence.
4. The app obtains authoritative source confirmation for its own old subject, verifies the destination binding, and links only that app's old/new identities.
5. The source can report whether its old identity should remain usable. The app handles that change explicitly and does not assume account deletion occurred.

This better matches one provider-move action followed by gradual app recognition. It introduces sensitive protocol work: authenticating public apps at confirmation, unlinkability across apps, revocation, replay, source availability, conflict handling and bounded multi-hop history. Assess the existing draft before defining a smaller Waypo extension; do not claim draft conformance from a custom proof format.

## Required boundaries for either candidate

- Identity porting never transfers administrator grants or installation service principals automatically.
- Billing remains with each provider until the user explicitly changes it; a port is not authority to start charges or grant unfunded storage.
- Storage migration needs its own immutable manifest, source/target authority, byte/hash checks and fresh destination epochs. Old offline outboxes cannot be silently rebound to the destination account.
- The source must retain the required proof/fences through the promised porting window. A deleted source or lost signing history cannot be treated as authenticated merely because a destination says so.
- Recovery remains separate. A local recovery file unlocks its original provider account; it is not a universal portable identity credential.

