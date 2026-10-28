// Annual recovery-file reissue offer (recovery and transfer spike §4.2, owner approval 2026-10-28). Pure scheduling:
// an offer is a reminder only. It changes no credential, and a file never expires by age.
//
// Slots, counted from the anniversary A = issuedAt + RECOVERY_REMINDER_PERIOD_MS of the CURRENT file:
//   slot 0  'upcoming'  from A - RECOVERY_REMINDER_LEAD_MS
//   slot 1  'due'       from A
//   slot k  'overdue'   from A + (k - 1) * RECOVERY_REMINDER_REPEAT_MS, for k >= 2 (monthly)
// A new file (setup, reissue commit, recovery) restarts the schedule because its issuedAt changes.

export const RECOVERY_REMINDER_PERIOD_MS = 365 * 86400000;
export const RECOVERY_REMINDER_LEAD_MS = 30 * 86400000;
export const RECOVERY_REMINDER_REPEAT_MS = 30 * 86400000;

/** The reminder state of a file issued at `issuedAt` (ms) at `now` (ms): {stage, slot, anniversaryAt, nextAt}.
 * `stage` is 'none' (slot -1) before the first slot. `nextAt` is when the next slot opens. Pure. */
export function recoveryReminder(issuedAt, now) {
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(now)) throw new TypeError('Recovery reminder times must be integers.');
  const anniversaryAt = issuedAt + RECOVERY_REMINDER_PERIOD_MS, first = anniversaryAt - RECOVERY_REMINDER_LEAD_MS;
  if (now < first) return Object.freeze({ stage: 'none', slot: -1, anniversaryAt, nextAt: first });
  if (now < anniversaryAt) return Object.freeze({ stage: 'upcoming', slot: 0, anniversaryAt, nextAt: anniversaryAt });
  const slot = 1 + Math.floor((now - anniversaryAt) / RECOVERY_REMINDER_REPEAT_MS);
  return Object.freeze({ stage: slot === 1 ? 'due' : 'overdue', slot, anniversaryAt, nextAt: anniversaryAt + slot * RECOVERY_REMINDER_REPEAT_MS });
}
