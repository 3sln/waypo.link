// Password retirement reset `passwords-retired-v1` (owner approval 2026-10-28: "drop passwords"; sign-in and intents
// spike §6.3, migration plan provisional, unsigned). Destructive cleanup is acceptable: there are no real users (owner
// direction 2026-10-27). Nothing is converted in place.
//
// Per identity record (`retirePassword`), one CAS, idempotent:
//   none   no `passwordHash`, `passwordSetAt` or `pendingPasswordSets`, and no session a password created or stepped up.
//   strip  the record keeps another sign-in method (a passkey or a sign-in email), or is recovering (the recovery file
//          resumes it and setup asks for a passkey), moved or already deleted: the password fields are deleted, every
//          session a password created or stepped up ends (with its descendants and approval lineage, as any explicit
//          termination), and the security epoch rises when an active or recovering record changed.
//   reset  an active, suspended, pending or pending-transfer record whose only sign-in method was a password (a
//          password-only account, or a sign-up or move that chose a password): the identity is tombstoned with reason
//          `password-retired` (packages/identity/lifecycle-tombstone.mjs), which keeps the handle bound and never
//          recycles it; account-store data follows the ordinary deletion path from that tombstone.
//
// `retirePasswords` runs one bounded slice over the repository's `lifecycleCandidates` pages (Node and Worker identity
// repositories both have it) and returns the next cursor; the caller repeats until `done`. Records already handled
// answer `none`, so a rerun after a crash or a completed run is harmless. Code no longer reads password fields, and
// `IdentityService#authorized` refuses password sessions, so the system is safe before the sweep has run; the sweep
// only removes the stored hashes and the accounts nobody can sign in to any more.
import { signInEmails } from './emails.mjs';
import { passwordSession } from './service.mjs';
import { lifecycleIdentityPort } from './lifecycle-tombstone.mjs';

export const PASSWORD_RETIREMENT_MARKER = 'migration/passwords-retired-v1';
const RESET = new Set(['active', 'suspended', 'pending', 'pending-transfer']);
const passwordFields = account => account?.passwordHash !== undefined && account.passwordHash !== null || account?.passwordSetAt !== undefined || account?.pendingPasswordSets !== undefined;
/** What the reset does to `account`: 'none', 'strip' or 'reset'. Pure. */
export function planPasswordRetirement(account) {
  if (!account || typeof account !== 'object') return 'none';
  const sessions = Array.isArray(account.sessions) ? account.sessions.filter(passwordSession) : [];
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
      await lifecycleIdentityPort(identity.repository, { clock: identity.clock }).tombstone(owner, { assignmentId: account.assignmentId, reason: 'password-retired' });
      return { action: 'reset' };
    }
    const revision = account.revision;
    delete account.passwordHash; delete account.passwordSetAt; delete account.pendingPasswordSets;
    if (Array.isArray(account.sessions)) await identity.pruneSessions(account, passwordSession);
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
