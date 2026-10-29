// Password-derived authority (owner approval 2026-10-28, "drop passwords"; sign-in and intents spike §6.3; review
// 2026-10-29 L1). Nothing reads a stored password any more; records written before password removal may still carry
// `passwordHash`, `passwordSetAt` or `pendingPasswordSets` and sessions a password created or stepped up. This module is
// the one place that recognises them, so that every authority check (IdentityService#authorized, linked approval,
// app lineage) and the reset (password-retirement.mjs) refuse the same things. Pure; no imports.
/** A session that a password created or stepped up (records from before password removal): refused everywhere. */
export const passwordSession = session => (session?.source??'credential')==='credential'&&typeof session?.credentialId!=='string'||session?.stepUpCredential?.kind==='password';
/** Whether `account` still carries stored password fields (a record from before password removal, not yet reset). */
export const passwordFields = account => account?.passwordHash !== undefined && account.passwordHash !== null || account?.passwordSetAt !== undefined || account?.pendingPasswordSets !== undefined;
/** Whether `session` holds authority derived from a password (review 2026-10-29 L1): it, or any session it was approved
 * from, is a password session, or it is an activation session (no passkey id) of a record that still carries password
 * fields (a password sign-up). An ancestor missing from the record counts as password-derived while the record still
 * carries password fields (fails closed; elsewhere a removed parent always took its descendants with it). Pure. */
export function passwordDerived(account, session) {
  const hasFields = passwordFields(account), seen = new Set();
  for (let current = session; current;) {
    if (passwordSession(current) || hasFields && current.source === 'activation' && typeof current.credentialId !== 'string') return true;
    const parent = current.parentSessionId; if (!parent) return false;
    if (seen.has(parent) || seen.size > 32) return true; seen.add(parent);
    current = (account?.sessions ?? []).find(item => item.id === parent);
    if (!current) return hasFields;
  }
  return false;
}
