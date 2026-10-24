// Redirect records on a moved tombstone (docs/architecture/identity-portability.md §6.4–§6.5; spec §10 "Ending early",
// IP-R1-L3). Pure transitions plus a revision-checked port over the identity repository. Every change leaves an
// address-free entry in `moved.audit` (event, time, reason, actor kind, chain position, delivery acceptance; never a
// host, identity URI, email address or order id), so the trail can outlive the address it describes.
//
//   endRedirect        the identity ends its redirect early (redirect management, packages/identity/redirect-management.mjs)
//   retargetRedirect   a verified later move (B→C) redirects to C at a redirect_base the identity supplied, signed in
//   reminderState      the opted-in expiry reminder: due 30 days before `redirectUntil`, at most REMINDER_ATTEMPTS tries
//   afterExtension     an extension recorded after the reminder went out deletes the reminder email (its job is done);
//                      one recorded before keeps it and moves the reminder to the new expiry
//
// Moved-record fields this module owns (alongside PORT-2's record, packages/identity/transfer-out.mjs `movedRecord`):
//   reminderEmail {address, verifiedAt}   opt-in only; deleted when the redirect ends or is extended after a reminder
//   reminder {for, attempts, attemptedAt, accepted}   attempt evidence for the expiry `for` (accepted = handed to the
//                                         mail transport; never a delivery claim)
//   retarget {to:{iss, identity}, seq, head, at}       the later host now redirected to (deleted with the redirect)
//   endedAt, endedBy                      an early end
//   settledOrder                          one-way digest of the extension order an early end settled (no order id kept),
//                                         so a redelivered webhook for it is not mistaken for a purchase that bought nothing
//   audit [...]                           at most AUDIT_LIMIT address-free entries
import { isUUID } from '../core/primitives.mjs';
import { movedWindow } from './lifecycle-tombstone.mjs';
import { parseMoveStatement } from './succession.mjs';

const HOUR = 3600000, DAY = 86400000;
export const REMINDER_LEAD = 30 * DAY;
/** Provisional timings (DEVLOG 2026-10-23, "Portability: redirect end/retarget, expiry reminder, intake gaps"). */
// `settlementMarker`: how long an ended record keeps `settledOrder`/`endedAt` (also in the purged tombstone) so that late
// provider events for an order the end settled are never refunded (review M2; covers Polar's refund/update horizon as
// assumed, unverified). `targetGone`: a target identity URI answering 404/410 this long ends the redirect (design §6.4).
export const REDIRECT_TIMING = Object.freeze({ reminderLead: REMINDER_LEAD, reminderRetry: DAY, reminderAttempts: 3, proofMinimum: 30 * DAY, settlement: 7 * DAY, settlementMarker: 400 * DAY, targetGone: 30 * DAY, probeEvery: DAY, probeMinimum: 3, probeGap: 3 * DAY });
export const AUDIT_LIMIT = 32;
const AUDIT_FIELDS = new Set(['event', 'at', 'reason', 'by', 'seq', 'accepted', 'attempt', 'proof', 'recorded', 'presented']);
const time = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The moved record's audit trail with `entry` appended. Only scalar, short, address-free members are kept. */
export function movedAudit(moved, entry) {
  const clean = {}; for (const [name, value] of Object.entries(entry ?? {})) if (AUDIT_FIELDS.has(name) && (typeof value === 'string' && value.length <= 64 && !value.includes(':') && !value.includes('@') || Number.isSafeInteger(value) || typeof value === 'boolean')) clean[name] = value;
  return [...(Array.isArray(moved?.audit) ? moved.audit.filter(plain) : []), clean].slice(-AUDIT_LIMIT);
}
/** One-way digest of an extension order id (unpadded base64url SHA-256, domain-separated). */
export async function orderDigest(id, { crypto = globalThis.crypto } = {}) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`3sln-redirect-extension-order\0${id}`)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
/** Where the live redirect points: the verified later host after a retarget, else the attested destination. */
export const redirectTo = moved => moved?.retarget?.to ?? moved?.to ?? null;

/** Early end (design §6.4 "end the redirect early (erasure)"; spec §10 "Ending early"). The redirect stops at once and
 * the new address, redirect base, retarget, destination keys and reminder email are deleted. The statement and
 * attestation stay for the move endpoint's idempotent replay (spec §5.2: at least 30 days after commit), and at most a
 * short settlement window after the end so that a redelivered payment webhook for a recorded extension is recognised
 * (`settledOrder`); they then go with the record as for any expiry. No refund is made: an extension that ran until the
 * owner ended it bought what it promised (design §6.4: an extension never overrides an owner's request to end). */
export async function endRedirect(moved, now, { by = 'owner', seq = null, proof = null, evidence = null, proved = null, crypto = globalThis.crypto } = {}) {
  if (!movedWindow(moved, now).live) return { moved, changed: false, live: false };
  const next = structuredClone(moved);
  if (next.reminderEmail) { delete next.reminderEmail; next.audit = movedAudit(next, { event: 'reminder-email-deleted', reason: 'ended', at: now }); }
  if (next.extensionOrder && typeof next.extensionOrder.id === 'string' && next.extensionOrder.refunded !== true) next.settledOrder = await orderDigest(next.extensionOrder.id, { crypto });
  // Destination key thumbprints (no address) stay until the record goes, so the verified owner's revival is not first use.
  for (const name of ['extensionOrder', 'retarget', 'to']) delete next[name];
  // `endedRedirectUntil` (a time, no address) lets the verified current owner revive an end within the settlement
  // window (review L4): an end needs only the weaker signature proof, so a former host may have made it.
  Object.assign(next, { redirectBase: null, redirectUntil: now, endedAt: now, endedBy: by, endedRedirectUntil: moved.redirectUntil });
  // Equivocation evidence (spec §8.4, review M1): two different attested records for one position, as digests.
  if (evidence) next.contested = { seq: evidence.seq, recorded: evidence.recorded, presented: evidence.presented, at: now };
  // Review R2-2: what the ender proved (head seq and the digests of the records after ours; no address). A revival must
  // extend it. When the end proved less than a recorded retarget, the retarget's chain is what stands.
  const provedDigests = Array.isArray(proved?.digests) ? proved.digests : [], kept = Array.isArray(moved.retarget?.digests) && moved.retarget.digests.length > provedDigests.length ? moved.retarget.digests : provedDigests;
  if (proved || moved.retarget) next.endedProof = { seq: Math.max(Number.isSafeInteger(proved?.seq) ? proved.seq : 0, moved.retarget?.seq ?? 0), digests: [...kept] };
  delete next.probe;
  const floor = time(moved.committedAt) ? moved.committedAt + REDIRECT_TIMING.proofMinimum : now;
  next.movedUntil = Math.max(floor, Math.min(time(moved.movedUntil) ? moved.movedUntil : now, now + REDIRECT_TIMING.settlement));
  next.audit = movedAudit(next, { event: evidence ? 'redirect-contested' : 'redirect-ended', by, at: now, ...Number.isSafeInteger(seq) ? { seq } : {}, ...proof ? { proof } : {}, ...evidence ? { seq: evidence.seq, recorded: evidence.recorded, presented: evidence.presented } : {} });
  return { moved: next, changed: true, live: true };
}

/** Retarget to a verified later move (spec §10 IP-R1-L3). `to` is the later record's destination, `redirectBase` the
 * base the identity supplied while signed in (validated on `to.iss` by the caller), `seq`/`head` the verified chain
 * head. A lower `seq` than an earlier retarget is stale; a different head at the same `seq` is a fork. */
export function retargetRedirect(moved, now, { to, redirectBase, seq, head, digests = null, keys = null }) {
  const window = movedWindow(moved, now);
  if (!window.live && !revivable(moved, now)) return { refused: 'not_live' };
  if (!window.live) return revive(moved, now, { to, redirectBase, seq, head, digests, keys });
  const current = moved.retarget;
  if (current) {
    if (current.seq > seq) return { refused: 'stale' };
    if (current.seq === seq && current.head !== head) return { refused: 'forked' };
    if (diverges(current, digests)) return { refused: 'forked' };
    if (current.seq === seq && moved.redirectBase === redirectBase && current.to?.identity === to.identity) return { moved, changed: false };
  }
  const next = structuredClone(moved);
  next.redirectBase = redirectBase; next.retarget = { to: { iss: to.iss, identity: to.identity }, seq, head, ...Array.isArray(digests) ? { digests: [...digests] } : {}, ...plain(keys) ? { keys: structuredClone(keys) } : {}, at: now };
  delete next.probe; // R2-4: a new target starts a new gone clock
  next.audit = movedAudit(next, { event: 'redirect-retargeted', by: 'owner', seq, at: now });
  return { moved: next, changed: true };
}
/** Whether a recorded retarget's chain digests (positions after ours) disagree with `digests` where both have one. */
export function diverges(retarget, digests) {
  if (!Array.isArray(retarget?.digests) || !Array.isArray(digests)) return false;
  for (let i = 0; i < Math.min(retarget.digests.length, digests.length); i++) if (retarget.digests[i] !== digests[i]) return true;
  return false;
}
/** An owner (or former-host) end inside the settlement window, before the original expiry, never a contested one. */
export function revivable(moved, now) {
  return moved?.endedBy === 'owner' && !moved.contested && time(moved.endedAt) && now - moved.endedAt < REDIRECT_TIMING.settlement && time(moved.endedRedirectUntil) && now < moved.endedRedirectUntil && movedWindow(moved, now).proof && typeof moved.statement === 'string';
}
/** Review L4: the verified current owner (full verification, as for a retarget) restores an ended redirect, pointing
 * it at its current host. The reminder email deleted by the end stays deleted. */
function revive(moved, now, { to, redirectBase, seq, head, digests, keys }) {
  let own; try { own = parseMoveStatement(moved.statement).payload; } catch { return { refused: 'not_live' }; }
  const next = structuredClone(moved);
  next.to = { iss: own.to.iss, identity: own.to.identity };
  next.redirectUntil = moved.endedRedirectUntil; next.movedUntil = Math.max(moved.movedUntil, moved.endedRedirectUntil);
  for (const name of ['endedAt', 'endedBy', 'endedRedirectUntil', 'endedProof', 'probe']) delete next[name];
  next.redirectBase = redirectBase;
  if (seq > own.seq) next.retarget = { to: { iss: to.iss, identity: to.identity }, seq, head, ...Array.isArray(digests) ? { digests: [...digests] } : {}, ...plain(keys) ? { keys: structuredClone(keys) } : {}, at: now };
  next.audit = movedAudit(next, { event: 'redirect-revived', by: 'owner', seq, at: now });
  return { moved: next, changed: true, revived: true };
}

/** The ended marker an expired or ended record keeps (review M2): no address, only what settles late payment events. */
export function settlementMarker(moved, now) {
  const endedAt = time(moved?.endedAt) ? moved.endedAt : time(moved?.redirectUntil) ? Math.min(moved.redirectUntil, now) : null;
  if (endedAt === null) return null;
  return { endedAt, until: endedAt + REDIRECT_TIMING.settlementMarker, ...typeof moved.settledOrder === 'string' ? { settledOrder: moved.settledOrder } : {} };
}

/** The expiry reminder at `now`: {done:true} (nothing to send, ever, for this record state), {nextAt} or {due, attempt}. */
export function reminderState(moved, now) {
  if (!movedWindow(moved, now).live || !plain(moved.reminderEmail) || typeof moved.reminderEmail.address !== 'string') return { done: true };
  const dueAt = moved.redirectUntil - REMINDER_LEAD, sent = moved.reminder?.for === moved.redirectUntil ? moved.reminder : null;
  // Review L3: only an attempt whose send threw ('failed') is retried; a claimed ('sending') or sent attempt counts as
  // sent, so a crash between sending and recording never sends a second email.
  if (sent && (sent.accepted === true || sent.state !== 'failed' || sent.attempts >= REDIRECT_TIMING.reminderAttempts)) return { done: true };
  if (now < dueAt) return { nextAt: dueAt };
  if (sent && now < sent.attemptedAt + REDIRECT_TIMING.reminderRetry) return { nextAt: sent.attemptedAt + REDIRECT_TIMING.reminderRetry };
  return { due: true, attempt: (sent?.attempts ?? 0) + 1 };
}

/** Applied to a moved record an extension (or an extension refund) just changed, `previous` being the record before.
 * Returns the record and when the reminder is next due (null: no reminder any more). */
export function afterExtension(previous, next, now) {
  if (!plain(next.reminderEmail)) return { moved: next, reminderAt: null };
  const extended = time(previous?.redirectUntil) && next.redirectUntil > previous.redirectUntil, reminded = time(previous?.reminder?.attemptedAt);
  if (extended && reminded) { const out = structuredClone(next); delete out.reminderEmail; out.audit = movedAudit(out, { event: 'reminder-email-deleted', reason: 'extended-after-reminder', at: now }); return { moved: out, reminderAt: null }; }
  return { moved: next, reminderAt: Math.max(now, next.redirectUntil - REMINDER_LEAD) };
}

/** Plain-language reminder (sent from the fixed notify@ sender). Names the new host only; the link is the redirect
 * page capability, which can only buy an extension of the already attested redirect. */
export function redirectReminderTemplate(notice, { origin, brand = '3sln.me' } = {}) {
  if (!plain(notice) || !time(notice.redirectUntil) || typeof notice.host !== 'string' || !/^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i.test(notice.host) || notice.link !== null && (typeof notice.link !== 'string' || !notice.link.startsWith(`${origin}/moved/`) || !/^[A-Za-z0-9_-]{64,240}$/.test(notice.link.slice(`${origin}/moved/`.length)))) throw new TypeError('Invalid redirect reminder.');
  const day = new Date(notice.redirectUntil).toISOString().slice(0, 10);
  const subject = `Your ${brand} redirect ends on ${day}`;
  const text = [`Old links to your former ${brand} identity send people to ${notice.host} until ${day}. After that they stop working.`,
    notice.link ? `To keep them working, you can buy a one-time 10-year extension here:\n${notice.link}` : null,
    `You asked for this reminder when you moved. This is the only message we send to this address, and we delete the address when the redirect ends.`].filter(Boolean).join('\n\n');
  return { subject, text };
}

/** Revision-checked redirect-record operations over any identity repository with get and compareAndSwap. */
export function redirectRecordsPort(repository, { clock = () => Date.now(), crypto = globalThis.crypto } = {}) {
  if (typeof repository?.get !== 'function' || typeof repository.compareAndSwap !== 'function') throw new TypeError('An identity repository is required.');
  /** `mutate(moved, account)` -> {moved, changed?, ...} | {refused} | other. Writes only a changed moved record. */
  const cas = async (sub, mutate) => {
    if (!isUUID(sub)) return { ok: false, status: 'missing' };
    for (let attempt = 0; attempt < 6; attempt++) {
      const account = await repository.get(sub);
      if (!account || account.id !== sub || account.status !== 'moved' || !plain(account.moved)) return { ok: false, status: 'missing' };
      const out = await mutate(account.moved, account) ?? {};
      if (out.refused) return { ok: false, status: out.refused };
      if (!out.moved || out.changed === false) return { ok: true, changed: false, ...out, moved: undefined, account };
      const next = structuredClone(account); next.moved = out.moved; next.revision = account.revision + 1;
      if (await repository.compareAndSwap(sub, account.revision, next)) return { ok: true, changed: true, ...out, moved: undefined, account: next };
    }
    return { ok: false, status: 'conflict' };
  };
  const bound = (moved, expect) => moved.statementDigest === expect;
  return Object.freeze({
    get: sub => isUUID(sub) ? repository.get(sub) : null,
    /** `expect`: the statement digest verified for this identity (the record must still be that move). */
    end: (sub, { expect, seq = null, by = 'owner', proof = null, evidence = null, proved = null }) => cas(sub, moved => bound(moved, expect) ? endRedirect(moved, clock(), { by, seq, proof, evidence, proved, crypto }) : { refused: 'changed' }),
    retarget: (sub, { expect, to, redirectBase, seq, head, digests = null, keys = null }) => cas(sub, moved => bound(moved, expect) ? retargetRedirect(moved, clock(), { to, redirectBase, seq, head, digests, keys }) : { refused: 'changed' }),
    /** R2-2: equivocation evidence against an ended record's proved chain marks it contested (never revivable). */
    contest: (sub, { expect, evidence }) => cas(sub, moved => {
      if (!bound(moved, expect)) return { refused: 'changed' };
      if (moved.contested) return { changed: false };
      const next = structuredClone(moved), now = clock(); next.contested = { seq: evidence.seq, recorded: evidence.recorded, presented: evidence.presented, at: now };
      next.audit = movedAudit(next, { event: 'redirect-contested', by: 'contested', at: now, seq: evidence.seq, recorded: evidence.recorded, presented: evidence.presented }); return { moved: next };
    }),
    /** Design §6.4: the target identity URI (`document(identity) -> {status}` of the portability client) answering
     * 404/410 for REDIRECT_TIMING.targetGone ends the redirect (`target-gone`, which is never revivable). Unreachable
     * or any other answer resets nothing but the gone clock. Returns {ok, nextAt?, done?}. */
    async probe(sub, { document }) {
      const account = await repository.get(sub); if (account?.status !== 'moved' || !plain(account.moved) || !movedWindow(account.moved, clock()).live) return { ok: true, done: true };
      const target = redirectTo(account.moved)?.identity; let gone = null;
      // `invalid` resets the clock like a live answer (R2-4); only an unreachable target leaves it (the gap rule covers outages).
      try { const answer = await document(target); gone = answer?.status === 'gone' ? true : ['ok', 'moved', 'redirect', 'invalid'].includes(answer?.status) ? false : null; } catch { gone = null; }
      if (gone === null) return { ok: true, nextAt: clock() + REDIRECT_TIMING.probeEvery };
      const out = await cas(sub, async moved => {
        const now = clock(); if (!movedWindow(moved, now).live || redirectTo(moved)?.identity !== target) return { changed: false };
        if (!gone) { if (!moved.probe) return { changed: false }; const next = structuredClone(moved); delete next.probe; return { moved: next }; }
        // R2-4: at least REDIRECT_TIMING.probeMinimum gone answers, none more than probeGap apart, spanning targetGone.
        const prior = plain(moved.probe) && time(moved.probe.lastAt) && now - moved.probe.lastAt <= REDIRECT_TIMING.probeGap ? moved.probe : null;
        const probe = { goneSince: prior ? prior.goneSince : now, count: (prior?.count ?? 0) + 1, lastAt: now };
        if (now - probe.goneSince >= REDIRECT_TIMING.targetGone && probe.count >= REDIRECT_TIMING.probeMinimum) return endRedirect(moved, now, { by: 'target-gone', crypto });
        const next = structuredClone(moved); next.probe = probe; return { moved: next };
      });
      if (!out.ok) return { ok: false, status: out.status };
      return out.account && !movedWindow(out.account.moved, clock()).live ? { ok: true, done: true, ended: true } : { ok: true, nextAt: clock() + REDIRECT_TIMING.probeEvery };
    },
    /** One reminder attempt when due. `send({email, redirectUntil, to, account}) -> boolean` (accepted by the transport).
     * The attempt is claimed in the record before sending, so concurrent sweeps never send twice for one attempt. */
    async remind(sub, { send }) {
      let claim = null;
      const claimed = await cas(sub, moved => {
        const state = reminderState(moved, clock()); if (!state.due) return { changed: false, state };
        const next = structuredClone(moved), at = clock(); next.reminder = { for: moved.redirectUntil, attempts: state.attempt, attemptedAt: at, accepted: false, state: 'sending' };
        claim = { for: moved.redirectUntil, attempt: state.attempt, email: structuredClone(moved.reminderEmail), to: redirectTo(moved) };
        return { moved: next };
      });
      if (!claimed.ok) return claimed.status === 'missing' ? { ok: true, done: true } : { ok: false, status: claimed.status };
      if (!claimed.changed) { const state = claimed.state ?? { done: true }; return state.nextAt ? { ok: true, done: false, nextAt: state.nextAt } : { ok: true, done: true }; }
      // Any send that did not throw is accepted (review L3); acceptance is never a delivery claim.
      let accepted = false; try { await send({ email: claim.email, redirectUntil: claim.for, to: claim.to, account: claimed.account }); accepted = true; } catch { accepted = false; }
      await cas(sub, moved => {
        if (moved.reminder?.for !== claim.for || moved.reminder.attempts !== claim.attempt) return { changed: false };
        const next = structuredClone(moved); next.reminder = { ...next.reminder, accepted, state: accepted ? 'sent' : 'failed' }; next.audit = movedAudit(next, { event: 'reminder-attempted', attempt: claim.attempt, accepted, at: clock() }); return { moved: next };
      });
      const after = await repository.get(sub), state = after?.status === 'moved' && plain(after.moved) ? reminderState(after.moved, clock()) : { done: true };
      return state.nextAt ? { ok: true, done: false, nextAt: state.nextAt, accepted } : { ok: true, done: true, accepted };
    },
  });
}

/** The sweep's `reminders` port (packages/identity/transfer-out.mjs `sweepTransferDue`) over the mail transport's
 * `sendRedirectReminder({email, notice})`. `capability(account)` gives the redirect page id (packages/runtime/
 * redirect-extension.mjs); without it the reminder still goes out, without the purchase link. Acceptance by the
 * transport is recorded; delivery is never claimed. */
export function createRedirectReminders({ records, mail = null, origin, capability = null, client = null }) {
  if (!records || typeof records.remind !== 'function' || typeof origin !== 'string' || new URL(origin).origin !== origin) throw new TypeError('Redirect reminders need records and an origin.');
  return Object.freeze({
    remind: owner => records.remind(owner, { async send({ email, redirectUntil, to, account }) {
      if (typeof mail?.sendRedirectReminder !== 'function' || typeof to?.iss !== 'string') throw new Error('No reminder transport.');
      let id = null; try { id = typeof capability === 'function' ? await capability(account) : null; } catch { id = null; }
      const notice = { redirectUntil, host: new URL(to.iss).host, link: typeof id === 'string' ? `${origin}/moved/${id}` : null };
      redirectReminderTemplate(notice, { origin });
      await mail.sendRedirectReminder({ email: email.address, notice });
      return true;
    } }),
    // The target probe (design §6.4, 30 days of 404): needs the portability client's `document`; without it rows wait.
    probe: owner => typeof client?.document === 'function' ? records.probe(owner, { document: identity => client.document(identity) }) : { ok: false, status: 'unconfigured' },
  });
}
