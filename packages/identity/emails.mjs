// Account email addresses and their three states (sign-in and intents spike §3.2, SI-1, SI-2, SI-23; owner approval
// 2026-10-28: "sign-in email" is the name; an address is unverified, verified or sign-in; only a verified address can
// become a sign-in email. Up to 3 verified addresses and one notice address (Q4). Field names provisional).
//
//   account.emails = [{
//     address,                      as entered; domain lowercased (the existing rule)
//     state: 'unverified'|'verified'|'sign-in',
//     verifiedAt?,                  identity clock (ms); absent while unverified
//     signInSince?,                 when the state last became 'sign-in'; bound into every email sign-in challenge
//     notices,                      exactly one verified or sign-in entry is the notice address
//     source: 'linked'|'setup-code'|'invitation'|'transfer'|'legacy',
//     addedBy: {session, at},       the kind of session that added it or (for a sign-in email) turned sign-in on:
//                                   'passkey'|'email'|'setup'|'recovery'|'legacy' (removal tiers, spike §6.4 RM-2/RM-3)
//     expiresAt?,                   unverified only: added + 24 h; an expired entry is gone (never shown, never indexed)
//   }]
//
// At most MAX_CONFIRMED_EMAILS verified or sign-in entries plus MAX_UNVERIFIED_EMAILS unverified one. Only verified and
// sign-in entries hold the uniqueness claim (`indexedEmails`); an unverified entry cannot squat an address, and its
// verification fails when another account verified the address first.
//
// Migration: a record written before this model carries `verifiedEmail`, `emailVerifiedAt` and `emailLoginEnabled`.
// Every reader here interprets those as one entry (state 'sign-in' when `emailLoginEnabled`), and `migrateEmails`
// rewrites the record on its next identity write. Destructive dev reset is acceptable (no users), but this costs little.
export const EMAIL_STATES = Object.freeze(['unverified', 'verified', 'sign-in']);
export const MAX_CONFIRMED_EMAILS = 3;
export const MAX_UNVERIFIED_EMAILS = 1;
export const UNVERIFIED_EMAIL_TTL_MS = 86400000;
/** A method under this age is "recent" (spike §6.4): RM-2 and RM-3 may undo it at once; older ones need Tier B. */
export const ESTABLISHED_METHOD_AGE_MS = 7 * 86400000;
const time = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function legacyEntries(account) {
  if (typeof account?.verifiedEmail !== 'string' || !account.verifiedEmail) return [];
  // A legacy record always held the uniqueness claim for `verifiedEmail`; one written without `emailVerifiedAt` keeps it
  // (verified at 0) rather than silently losing its index.
  const signIn = account.emailLoginEnabled === true, at = time(account.emailVerifiedAt) ? account.emailVerifiedAt : 0;
  return [{ address: account.verifiedEmail, state: signIn ? 'sign-in' : 'verified', verifiedAt: at, ...signIn ? { signInSince: at } : {}, notices: true, source: 'legacy', addedBy: { session: 'legacy', at } }];
}
function validEntry(entry) {
  if (!plain(entry) || typeof entry.address !== 'string' || !entry.address || !EMAIL_STATES.includes(entry.state)) return false;
  if (entry.state === 'unverified') return time(entry.expiresAt);
  return time(entry.verifiedAt) && (entry.state !== 'sign-in' || time(entry.signInSince));
}
/** Every live entry of `account` (legacy fields read as one entry), without expired unverified ones. `now` omitted
 * keeps unverified entries regardless of expiry (index and migration use; never for display or authority). Pure. */
export function accountEmails(account, now) {
  const raw = Array.isArray(account?.emails) ? account.emails : legacyEntries(account);
  return raw.filter(entry => validEntry(entry) && (entry.state !== 'unverified' || now === undefined || entry.expiresAt > now));
}
/** Verified and sign-in entries (the addresses that receive security notices). Pure. */
export const confirmedEmails = account => accountEmails(account).filter(entry => entry.state !== 'unverified');
/** Sign-in entries only. Pure. */
export const signInEmails = account => accountEmails(account).filter(entry => entry.state === 'sign-in');
/** The addresses holding the uniqueness claim: every verified or sign-in address. Pure; no clock. */
export const indexedEmails = account => [...new Set(confirmedEmails(account).map(entry => entry.address))];
/** The notice entry (the verified or sign-in address chosen for ordinary notices), or null. A record whose flags are
 * inconsistent falls back to the first confirmed entry, so a notice address exists whenever any confirmed one does. */
export function noticeEntry(account) {
  const confirmed = confirmedEmails(account);
  return confirmed.find(entry => entry.notices === true) ?? confirmed[0] ?? null;
}
export const noticeEmail = account => noticeEntry(account)?.address ?? null;
/** The entry for `address` in any live state, or null. */
export const emailEntry = (account, address, now) => accountEmails(account, now).find(entry => entry.address === address) ?? null;
/** Whether `address` is a confirmed (verified or sign-in) address of `account`. */
export const ownsEmail = (account, address) => confirmedEmails(account).some(entry => entry.address === address);
/** The legacy single-address view, for internal projections whose contract still names one address (lifecycle,
 * deletion and admin evidence): the notice address, when it was verified, and whether it is a sign-in email. */
export function legacyEmailView(account) {
  const entry = noticeEntry(account);
  return { verifiedEmail: entry?.address ?? null, emailVerifiedAt: entry ? entry.verifiedAt : null, emailLoginEnabled: entry?.state === 'sign-in' };
}
/** The owner-facing projection (Settings → Sign-in). No challenge, hash or session data. */
export function emailProjection(account, now) {
  const notice = noticeEntry(account);
  return accountEmails(account, now).map(entry => ({ address: entry.address, state: entry.state, ...entry.state === 'unverified' ? { expiresAt: entry.expiresAt } : { verifiedAt: entry.verifiedAt }, ...entry.state === 'sign-in' ? { signInSince: entry.signInSince } : {}, notices: entry.state !== 'unverified' && entry === notice, recent: entry.state === 'sign-in' && time(now) && now - entry.signInSince < ESTABLISHED_METHOD_AGE_MS }));
}
/** Rewrites the record in place to the `emails[]` model: legacy fields become entries, expired unverified entries are
 * dropped (only when `now` is given), and exactly one confirmed entry carries `notices`. Idempotent. */
export function migrateEmails(account, now) {
  if (!plain(account)) return account;
  const entries = (Array.isArray(account.emails) ? account.emails : legacyEntries(account)).filter(entry => validEntry(entry) && (entry.state !== 'unverified' || now === undefined || entry.expiresAt > now)).map(entry => ({ ...entry }));
  const notice = entries.find(entry => entry.state !== 'unverified' && entry.notices === true) ?? entries.find(entry => entry.state !== 'unverified');
  for (const entry of entries) entry.notices = entry === notice;
  if (entries.length || Array.isArray(account.emails) || 'verifiedEmail' in account) account.emails = entries;
  delete account.verifiedEmail; delete account.emailVerifiedAt; delete account.emailLoginEnabled;
  return account;
}
