# Bounded authority history

> **Status:** Proposed design; implementation varies. Consult the implementation map and release gates.

Engineering candidate, 2026-11-03. Not implemented or owner-approved by this document. This is a reference implementation capacity and recovery choice, not an OIDC or Waypo wire requirement.

## Problem

An account can currently retain revoked grant/family/session history and one native replay revision for every client it has ever used. A cap on current consents or anonymous discovery leases does not bound that lifetime history: a user can disconnect one app and approve another repeatedly. Removing old records merely because consent disappeared can accidentally make an old accepted job or credential look current again.

The capacity boundary must include native replay markers, metadata grant/family/session fences and references retained by queued work. An account deletion collector is necessary, but does not solve growth in accounts that remain active.

## Candidate: account epoch with a bounded client registry

Keep one permanent native epoch per account and a bounded registry of client revisions (initial candidate: 128 entries). Accepted background work captures the account epoch and client revision as part of its verified authority. Every publication checks both against current authority. A normally authenticated request derives a fresh snapshot only after verifying its actual native credential, current consent, scopes and account policy.

When the registry needs another entry beyond its bound, advance the account epoch and reset the client registry in the same native transaction. Pre-rollover accepted work now has the wrong epoch and fails closed. Current unrelated app requests can continue after fresh ordinary verification; the rollover must not turn a revoked token into an authenticated caller or manufacture consent.

Example flow:

1. Alice has approved Notebook and Connect. Each has its own current native credentials and grants.
2. Enough historical client changes accumulate to require a registry rollover. The provider atomically advances Alice's account epoch.
3. An older queued Connect digest reaches its publication deadline. Its captured epoch is stale, so the provider cancels it.
4. Notebook makes a new request with a still-valid native credential and current consent. The provider verifies them and derives authority in the new epoch; its document access continues.
5. A previously replay-invalidated token is presented. Native family/token verification still denies it, regardless of the newer epoch.

The deliberate tradeoff is that rare rollover cancels older queued effects, including effects from unrelated apps on the same account. This must be documented and observable through bounded status/audit results. It is not evidence of successful delivery. Do not silently replace a rejected accepted snapshot with newly derived user authority.

## Migration and proof obligations

Legacy accepted work is treated as epoch zero. Install a durable epoch of at least one before removing any legacy per-client replay markers. Installing the epoch and retiring native markers must be atomic; metadata cleanup can then proceed in bounded batches because old snapshots remain fenced even if cleanup crashes. A consent removal alone never authorizes retirement.

Before selecting this design, the identity and platform owners must agree the exact retirement rules for all three metadata histories, current native credentials and queued references. Required evidence includes:

- Overflow cancels old and legacy epoch-zero jobs without reviving a revoked family, even if metadata mirroring fails.
- Unrelated normally verified callers continue; stale accepted snapshots cannot be refreshed into new authority.
- Native rollback/crash/restart preserves the migration fence and bounded registry.
- Current sessions/families/grants survive only under their actual current native and policy checks; cleanup cannot manufacture a new grant.
- Repeated disconnect/new-client cycles leave bounded stored history, with measured native SQL/KV work rather than an inferred economic claim.

An alternative is dependency-aware retirement after every old credential and accepted-work reference is provably terminal. That avoids broad queued-work cancellation, but needs complete bounded dependency accounting and does not yet have an implementation/proof here. Keep the existing fail-closed history until a selected retirement mechanism is verified.
