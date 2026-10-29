// Password retirement reset `passwords-retired-v1` (owner approval 2026-10-28: "drop passwords"; sign-in and intents
// spike §6.3, migration plan provisional, unsigned). Destructive cleanup is acceptable: there are no real users (owner
// direction 2026-10-27). Nothing is converted in place.
//
// Per identity record (`retirePassword`), one CAS, idempotent:
//   none   no `passwordHash`, `passwordSetAt` or `pendingPasswordSets`, and no session a password created or stepped up.
//   strip  the record keeps another sign-in method (a passkey or a sign-in email), or is recovering (the recovery file
//          resumes it and setup asks for a passkey), moved or already deleted: the password fields are deleted, every
//          password-derived session (`passwordDerived`) ends (with its descendants and approval lineage, as any
//          explicit termination), app lineages approved before password removal whose chain cannot be checked end, and the security epoch rises when an active or recovering record changed.
//   reset  an active, suspended, pending or pending-transfer record whose only sign-in method was a password (a
//          password-only account, or a sign-up or move that chose a password): the identity is tombstoned, only if the
//          record still has the revision the plan was read at, with reason
//          `password-retired` (packages/identity/lifecycle-tombstone.mjs), which keeps the handle bound and never
//          recycles it; account-store data follows the ordinary deletion path from that tombstone.
//
// `retirePasswords` runs one bounded slice over the repository's `lifecycleCandidates` pages (Node and Worker identity
// repositories both have it) and returns the next cursor; the caller repeats until `done`. Records already handled
// answer `none`, so a rerun after a crash or a completed run is harmless. Triggers: Node runs `retireAllPasswords` once
// per data directory at boot; the Worker runs `retirePasswordsStep` from the cron trigger and the lifecycle scheduler's
// alarm (apps/worker/lifecycle.mjs), one time-bounded batch of slices per run, with the cursor and the completion marker
// in the scheduler object's storage.
//
// Safety does not depend on the sweep (review 2026-10-29 L1). Code no longer reads password fields; `passwordDerived`
// (service.mjs) refuses, at use time, a password session, any session approved from one, an activation session of a
// record that still carries password fields, an approved-but-unconsumed linked request whose approver is such a session,
// and an app lineage approved from one (`LinkedApproval#lineageLive`). The sweep removes the stored hashes, ends those
// sessions and lineages explicitly, and deletes the accounts nobody can sign in to any more.
//
// The reset is revision-checked (review 2026-10-29 L2): the tombstone is written only if the record still has the
// revision the plan was made from, so a record that changed in between (a recovery started, a passkey added) is
// planned again instead of being deleted.
import { signInEmails } from './emails.mjs';
import { IdentityService } from './service.mjs';
import { passwordDerived, passwordFields } from './password-authority.mjs';
import { lifecycleIdentityPort } from './lifecycle-tombstone.mjs';
import { revokeLineageWhere } from './linked-approval.mjs';

export const PASSWORD_RETIREMENT_MARKER = 'migration/passwords-retired-v1';
const RESET = new Set(['active', 'suspended', 'pending', 'pending-transfer']);
/** App lineages that cannot be shown to come from passkey authority: written before password removal (no
 * `passwordFree`) with a chain session that is password-derived or no longer on the record. */
const doubtfulLineage = account => entry => entry.passwordFree !== true && entry.sessions.some(id => { const session = (account.sessions ?? []).find(s => s.id === id); return !session || passwordDerived(account, session); });
/** What the reset does to `account`: 'none', 'strip' or 'reset'. Pure. */
export function planPasswordRetirement(account) {
  if (!account || typeof account !== 'object') return 'none';
  const sessions = Array.isArray(account.sessions) ? account.sessions.filter(session => passwordDerived(account, session)) : [];
  const fields = passwordFields(account);
  if (!fields && !sessions.length) return 'none';
  const otherMethod = (account.credentials ?? []).length > 0 || signInEmails(account).length > 0;
  // A record without stored password fields whose sessions alone are password sessions keeps its other methods.
  return fields && !otherMethod && RESET.has(account.status) ? 'reset' : 'strip';
}
/** Applies the reset to one identity. `identity` is the IdentityService (its repository, session pruning and save).
 * Resolves {action: 'none'|'stripped'|'reset'}. */
export async function retirePassword(identity, owner) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const account = await identity.repository.get(owner);
    const plan = planPasswordRetirement(account);
    if (plan === 'none') return { action: 'none' };
    if (plan === 'reset') {
      try { await lifecycleIdentityPort(identity.repository, { clock: identity.clock }).tombstone(owner, { assignmentId: account.assignmentId, reason: 'password-retired', expectedRevision: account.revision }); }
      catch (error) { if (error?.code === 'lifecycle_identity_changed') continue; throw error; }
      return { action: 'reset' };
    }
    const revision = account.revision;
    // Decide which sessions and lineages are password-derived while the fields that identify a password sign-up remain.
    const derived = new Set((account.sessions ?? []).filter(session => passwordDerived(account, session))), doubtful = passwordFields(account) ? doubtfulLineage(account) : null;
    if (doubtful) revokeLineageWhere(account, doubtful, identity.clock());
    delete account.passwordHash; delete account.passwordSetAt; delete account.pendingPasswordSets;
    if (Array.isArray(account.sessions)) await identity.pruneSessions(account, session => derived.has(session));
    identity.audit(account, 'password-retired');
    if (['active', 'recovering'].includes(account.status)) identity.securityChanged(account);
    try { await identity.save(account, revision); return { action: 'stripped' }; } catch (error) { if (error?.code !== 'conflict') throw error; }
  }
  throw Object.assign(new Error('The identity changed during password retirement; retry later.'), { code: 'conflict', status: 409 });
}
/** One bounded slice of the reset over `identity.repository.lifecycleCandidates`. Resolves {cursor, done, stripped,
 * reset, failed}; a record that keeps failing is counted and skipped (it is retried by the next full run). */
export async function retirePasswords(identity, { cursor, limit = 100 } = {}) {
  if (typeof identity?.repository?.lifecycleCandidates !== 'function') throw new TypeError('An identity repository with lifecycleCandidates is required.');
  const page = await identity.repository.lifecycleCandidates({ cursor, limit });
  const outcome = { stripped: 0, reset: 0, failed: 0 };
  for (const row of page.accounts ?? []) {
    try { const { action } = await retirePassword(identity, row.id); if (action !== 'none') outcome[action]++; } catch { outcome.failed++; }
  }
  return { ...outcome, cursor: page.cursor ?? null, done: !page.cursor };
}
/** Worker trigger (review 2026-10-29 L1): runs slices for at most `budgetMs`, keeping the cursor and the completion marker
 * in `store` {get, put, delete} (the lifecycle scheduler object's storage). Resolves {done, skipped?, stripped, reset,
 * failed}. A run with failures leaves no marker, so the next full pass retries those records. */
export async function retirePasswordsStep(identity, store, { limit = 100, budgetMs = 20000, now = () => Date.now() } = {}) {
  if (await store.get(PASSWORD_RETIREMENT_MARKER) !== undefined) return { done: true, skipped: true };
  const key = `${PASSWORD_RETIREMENT_MARKER}/progress`, started = now();
  const progress = await store.get(key) ?? { cursor: null, stripped: 0, reset: 0, failed: 0 };
  do {
    const result = await retirePasswords(identity, { cursor: progress.cursor ?? undefined, limit });
    for (const name of ['stripped', 'reset', 'failed']) progress[name] += result[name];
    if (result.done) {
      await store.delete(key);
      if (!progress.failed) await store.put(PASSWORD_RETIREMENT_MARKER, { version: 1, completedAt: identity.clock(), stripped: progress.stripped, reset: progress.reset, failed: 0 });
      return { done: true, stripped: progress.stripped, reset: progress.reset, failed: progress.failed };
    }
    progress.cursor = result.cursor; await store.put(key, progress);
  } while (now() - started < budgetMs);
  return { done: false, stripped: progress.stripped, reset: progress.reset, failed: progress.failed };
}
/** A minimal IdentityService for the reset on a host that composes none outside requests (the Worker scheduler):
 * the repository, clock and crypto only; every interactive resource refuses. */
export function retirementIdentity({ repository, origin, rpID, termsVersion = '2026-10-11', allowInsecureLocalhost = false, clock = () => Date.now() }) {
  const unsupported = async () => { throw new Error('Unavailable during the password reset.'); };
  return new IdentityService({ repository, crypto: globalThis.crypto, clock, turnstile: { verify: unsupported }, rateLimiter: { check: unsupported }, webauthn: { verifyRegistration: unsupported, verifyAuthentication: unsupported }, config: { origin, rpID: rpID ?? new URL(origin).hostname, termsVersion, allowInsecureLocalhost } });
}
/** Runs slices until done (Node boot, tests). `marker` {get, put} records completion so later boots skip the sweep. */
export async function retireAllPasswords(identity, { marker, limit = 100, maxSlices = 10000 } = {}) {
  if (marker && await marker.get(PASSWORD_RETIREMENT_MARKER) !== undefined) return { done: true, skipped: true };
  const total = { stripped: 0, reset: 0, failed: 0 }; let cursor;
  for (let slice = 0; slice < maxSlices; slice++) {
    const result = await retirePasswords(identity, { cursor, limit });
    for (const key of Object.keys(total)) total[key] += result[key];
    if (result.done) { if (marker && !total.failed) await marker.put(PASSWORD_RETIREMENT_MARKER, { version: 1, completedAt: identity.clock(), ...total }); return { ...total, done: true }; }
    cursor = result.cursor;
  }
  return { ...total, done: false };
}
