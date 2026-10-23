// PORT-2: identity transfer-out at the source (docs/architecture/identity-portability.md §3.1, §3.3, §6.1, §6.1a,
// §6.3–§6.5; docs/spec/identity-portability.md §5.2, §6). Engine-first: `TransferOutService` is the account-placement
// provider resource (dispatched in the account single writer by packages/runtime/account/transfer-out.mjs) and the
// Actions/Queries at the end of this file are the operations. HTTP (packages/runtime/routes/moved.mjs) is a thin adapter.
//
// Flag: IDENTITY_TRANSFER_OUT_ENABLED (default off). `enabled(owner)` gates NEW transfers only (begin, both authorize
// paths). Statements, steps and commits of a transfer that already exists follow the env kill switch only
// (`background`), so turning the flag off never strands a pending move; a kill halts commits and keeps everything.
// Cancellation, disputes and aborts are the safe direction and are never gated.
//
// Persons only. Organization moves (§6.2: 72 h, admin block, elevation, tight verification, 30-day cooling) need the
// organizations slice, which does not exist yet; an organization identity is refused here.
//
// Records (account store, one per account):
//   transfer-out/v1       the current transfer: draft → pending ⇄ held → committed | cancelled | expired | aborted | contested
//   transfer-out/lock-v1  {restart?, contested?, elevatedAbort?}: restart block after a dispute or automatic cancel
//                         (spec §6.2, IP-R1-M2), the support lock (P17) and the 30-day contest window after an
//                         elevated-proof abort.
//
// Ports (TransferOutPorts; a port that is `undefined` is misconfigured and the operation refuses or holds):
//   identity  transferIdentityPort(repository) below: get, verifyRecovery, markMoved, removeDisputers, invalidateRecovery
//   keys      {current(owner) -> {kid, publicJwk}|null, matches(owner, keychain) -> boolean, destroy(owner)}
//   notices   {deliver(notice) -> {accepted}}   createTransferNotices below. Acceptance is not delivery.
//   attestor  {kid, sign(payload) -> JWS} | null   attestorFromJwk below (the P16 key set). Null: commits hold.
//   hold      owner -> {held}                   explicit administrator (legal) hold
//   effects   {revokeDelegations, severConnections, eraseGrants, purge(owner) -> {done, wakeAt?, halted?}}
//   due       {put(owner, at, kind), delete(owner, at, kind)}   transferDueIndex below (scheduler backstop)
//   issuer    this provider's issuer origin
import { AppAction, AppQuery } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { isUUID } from '../core/primitives.mjs';
import { base64url } from '../core/records.mjs';
import { parseMoveStatement, verifyMoveStatement, statementDigest, validateRedirectBase, httpsOrigin, SuccessionError } from './succession.mjs';
import { IdentityCrypto, secureEqual } from './crypto.mjs';
import { recoveryCredential, securityState } from './service.mjs';
import {raiseAuthorityEpoch} from './authority-epoch.mjs';
import { revokeAllLineage, revokeLineage, pruneLineage } from './linked-approval.mjs';
import { movedWindow, MOVED_AUDIT } from './lifecycle-tombstone.mjs';
import { attestorFromConfig } from './attestation-keys.mjs';

export const TRANSFER_FLAG = 'IDENTITY_TRANSFER_OUT_ENABLED';
export const TRANSFER_KEY = 'transfer-out/v1', LOCK_KEY = 'transfer-out/lock-v1';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
/** Design §6.7 (P19) and §6.1a. All in milliseconds. */
export const TIMING = Object.freeze({
  personDelay: 24 * HOUR, freshDelay: 72 * HOUR, finalDelay: 24 * HOUR, waitingPeriod: 7 * DAY, expiry: 7 * DAY,
  credentialAge: 7 * DAY, securityLookback: 7 * DAY, holdExpiry: 30 * DAY, contestWindow: 30 * DAY, supportLockMax: 30 * DAY,
  stepUp: 10 * MINUTE, redirect: 90 * DAY, exportWindow: 30 * DAY, attestationRetention: 30 * DAY, removedChannels: 30 * DAY,
  statementSkew: 5 * MINUTE, draftTtl: 30 * MINUTE, noticeGiveUp: DAY,
});
export const TRANSFER_STATES = Object.freeze(['draft', 'pending', 'held', 'contested', 'committed', 'cancelled', 'expired', 'aborted']);
const LIVE = new Set(['pending', 'held']), TERMINAL = new Set(['cancelled', 'expired', 'aborted']);
// Purge is the last stage; everything before it is idempotent and recorded in `record.stages`.
export const COMMIT_STAGES = Object.freeze(['identity', 'keys', 'delegations', 'connections', 'grants', 'due', 'notice']);
const MAX_PUSH = 16, MAX_TOKENS = 64, MAX_DISPUTES = 32, TOKEN = /^[A-Za-z0-9_-]{43}$/;
// Deletion records this engine reads but never writes (packages/runtime/account-deletion.mjs, lifecycle-storage.mjs).
const DELETION_REQUEST = 'deletion/request-v1', DELETION_FENCE = 'deletion/fence-v1', PURGE = 'lifecycle/purge-v1', TOMBSTONE = 'lifecycle/tombstone-v1';

const fail = (code, message, status = 400) => { throw new AppFault(code, message, status); };
const notFound = () => fail('not_found', 'Not found.', 404);
const unavailable = (message = 'Moving your identity is temporarily unavailable.') => fail('transfer_unavailable', message, 503);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => { if (value === undefined) return {}; if (!plain(value) || Object.keys(value).some(name => !names.includes(name))) fail('invalid_request', 'Unsupported transfer request.'); return value; };
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const seconds = ms => Math.floor(ms / 1000);
const time = value => Number.isSafeInteger(value) && value >= 0;
const channelKey = channel => `${channel.kind}:${channel.id}`;
/** The identity URI 3sln.me uses for `sub` (organizations spec §3a: `<issuer>/identity/<sub>`). */
export const identityURI = (issuer, sub) => `${issuer}/identity/${sub}`;

/** New transfers: the evaluated owner flag. Unknown flag rows and errors are off. */
export function transferEnabled(flags, owner) { try { return flags.for({ subject: { kind: 'account', owner } }).enabled(TRANSFER_FLAG) === true; } catch { return false; } }
/** Continuation (statements, steps, commits) follows only the env kill switch. */
export function transferBackground(flags, owner) { try { return flags.for({ subject: { kind: 'account', owner } }).background(TRANSFER_FLAG) === true; } catch { return false; } }
export function transferGlobal(flags) { try { return flags.for({}).global(TRANSFER_FLAG) === true; } catch { return false; } }

/** A transfer that blocks account deletion from being scheduled (one is refused while the other runs; IP-R1-L10). */
export async function transferBlocksDeletion(reader) { const record = await reader.get(TRANSFER_KEY); return record?.state === 'committed'; }

// ---- views ----------------------------------------------------------------------------------------------------

/** The owner's own projection. `410 identity_moved` information appears only here (spec §6.3). */
export function transferView(record, { now } = {}) {
  if (!record) return { state: 'none' };
  const base = { state: record.state, path: record.path ?? null, destination: record.destination ?? null, createdAt: record.createdAt ?? null };
  if (record.state === 'draft') return { ...base, draft: record.id, expiresAt: record.expiresAt };
  if (record.state === 'committed') return { ...base, error: 'identity_moved', moved: { to: record.statement?.to ?? null, committedAt: record.committedAt, exportUntil: record.exportUntil, redirectUntil: record.redirectUntil } };
  const pending = LIVE.has(record.state);
  return {
    ...base, notBefore: notBefore(record), expiresAt: record.statement ? null : record.expiresAt, statementReceived: Boolean(record.statement),
    hold: record.hold ? { since: record.hold.at, until: record.hold.expiresAt } : null, disputed: (record.disputes?.length ?? 0) > 0,
    freshDelay: record.elevated?.side === 'requester' && pending, redirect: record.redirect === true,
    ...pending && !record.statement ? { transfer: { id: record.transfer.id, exp: record.transfer.exp } } : {},
    ...TERMINAL.has(record.state) ? { endedAt: record.endedAt ?? null, reason: record.reason ?? null } : {},
    ...now !== undefined && pending ? { waiting: notBefore(record) === null ? 'notices' : notBefore(record) > now ? 'delay' : record.statement ? 'commit' : 'statement' } : {},
  };
}
const notBefore = record => time(record?.noticedAt) ? record.noticedAt + record.delay : null;

// ---- the service ----------------------------------------------------------------------------------------------

export class TransferOutService {
  #tail = Promise.resolve();
  /** `executor`: the account controller (metadata) or a test composition. `ports`: TransferOutPorts or a thunk. */
  constructor({ executor, ports, flags, clock, random, log = () => {}, wake }) {
    if (!executor?.metadata || typeof flags?.for !== 'function' || typeof clock?.now !== 'function' || typeof random?.bytes !== 'function' || typeof random?.uuid !== 'function') throw new TypeError('Transfer-out dependencies are required.');
    Object.assign(this, { executor, portSource: ports, flags, clock, random, log, wake });
  }
  get metadata() { return this.executor.metadata; }
  get ports() { const value = typeof this.portSource === 'function' ? this.portSource() : this.portSource; return plain(value) ? value : {}; }
  port(name) { const value = this.ports[name]; if (value === undefined) unavailable('Moving your identity is not configured.'); return value; }
  now() { const now = this.clock.now(); if (!time(now)) unavailable(); return now; }
  get issuer() { const issuer = this.ports.issuer; if (!httpsOrigin(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(issuer ?? '')) unavailable('Moving your identity is not configured.'); return issuer; }
  serial(work) { const run = this.#tail.then(work, work); this.#tail = run.catch(() => {}); return run; }
  token() { return base64url(this.random.bytes(32)); }
  async arm(at) { if (!time(at)) return; try { if (typeof this.wake === 'function') await this.wake(at); } catch { /* the due-index sweep is the backstop */ } }
  async bound(owner) { const stored = await this.metadata.get('owner'); if (stored !== owner) fail(stored === undefined ? 'account_unavailable' : 'forbidden', stored === undefined ? 'Account unavailable.' : 'Account owner mismatch.', stored === undefined ? 409 : 403); }
  /** Revision-checked update of the current record; returns the new record or null when it changed. */
  async update(record, mutate) {
    return this.metadata.transaction(async tx => {
      const current = await tx.get(TRANSFER_KEY); if (current?.id !== record.id || current.revision !== record.revision) return null;
      const next = mutate(structuredClone(current)); if (!next) return null; next.revision = current.revision + 1; await tx.put(TRANSFER_KEY, next); return next;
    });
  }
  /** Id-checked update that tolerates concurrent revisions; `mutate` re-checks state. */
  async patch(id, mutate) {
    return this.metadata.transaction(async tx => {
      const current = await tx.get(TRANSFER_KEY); if (current?.id !== id) return null;
      const next = mutate(structuredClone(current), tx); if (!next) return null; next.revision = current.revision + 1; await tx.put(TRANSFER_KEY, next); return next;
    });
  }
  async lock() { return (await this.metadata.get(LOCK_KEY)) ?? {}; }
  async setLock(mutate) { return this.metadata.transaction(async tx => { const next = mutate(structuredClone((await tx.get(LOCK_KEY)) ?? {})); if (next && Object.keys(next).length) await tx.put(LOCK_KEY, next); else await tx.delete(LOCK_KEY); return next; }); }

  // ---- eligibility ----

  /** Facts every new transfer needs; refuses with an owner-facing code (this is the owner's own surface). */
  async eligible(owner, { now, allowRestart = false, actor } = {}) {
    await this.bound(owner);
    if (await this.metadata.get(TOMBSTONE) !== undefined) fail('account_deleted', 'This account was deleted.', 410);
    const request = await this.metadata.get(DELETION_REQUEST);
    if (['scheduled', 'executing'].includes(request?.state) || await this.metadata.get(DELETION_FENCE) !== undefined || await this.metadata.get(PURGE) !== undefined) fail('deletion_scheduled', 'Cancel the scheduled account deletion first.', 409);
    const identity = await this.port('identity').get(owner);
    if (!identity) fail('account_unavailable', 'Account unavailable.', 409);
    if (identity.status !== 'active') fail('account_not_active', identity.status === 'moved' ? 'This identity has already moved.' : 'Moving is not available for this account.', 409);
    if (identity.kind !== 'person') fail('organization_moves_unavailable', 'Organization moves are not available yet.', 409);
    let held; try { held = (await this.port('hold')(owner))?.held !== false; } catch { held = true; }
    if (held) fail('account_held', 'This account is under an administrative hold.', 423);
    const existing = await this.metadata.get(TRANSFER_KEY);
    if (existing?.state === 'committed') fail('account_not_active', 'This identity has already moved.', 409);
    if (existing && (LIVE.has(existing.state) || existing.state === 'contested')) fail('transfer_pending', 'A move is already pending for this identity.', 409);
    const lock = await this.lock();
    if (lock.contested && (lock.contested.until === null || lock.contested.until > now)) fail('transfer_locked', 'Moving this identity is locked until support decides.', 423);
    if (lock.elevatedAbort && now - lock.elevatedAbort.at < TIMING.contestWindow && actor && !sameCredential(lock.elevatedAbort, actor)) { await this.contest(null, 'conflicting-request-after-elevated-abort', now); fail('transfer_contested', 'Moving this identity is locked until support decides.', 423); }
    if (now - identity.security.changedAt < TIMING.securityLookback) fail('recent_security_change', 'Wait 7 days after a security change before moving your identity.', 409);
    return { identity, lock, allowRestart };
  }
  /** P14 and §1.1: the current v2 credential, issued ≥ 7 days ago, whose keychain still restores. */
  async credential(owner, identity, { recoveryToken, keychain }, now) {
    if (typeof recoveryToken !== 'string' || recoveryToken.length > 150) fail('recovery_required', 'Load your current recovery file.', 400);
    const verified = await this.port('identity').verifyRecovery(owner, recoveryToken);
    // A superseded, consumed, resume-only or legacy credential fails exactly like a wrong one.
    if (!verified || verified.version !== 2 || verified.issuedAt !== identity.recovery?.issuedAt || verified.ref !== identity.recovery?.ref) fail('recovery_invalid', 'This recovery file cannot authorize a move. Use your newest recovery file.', 400);
    if (now - verified.issuedAt < TIMING.credentialAge) fail('recovery_too_new', 'Your recovery file must be at least 7 days old before you can move your identity.', 409);
    let matches = false; try { matches = await this.port('keys').matches(owner, keychain) === true; } catch { matches = false; }
    if (!matches) fail('recovery_invalid', 'This recovery file cannot authorize a move. Use your newest recovery file.', 400);
    return { ref: verified.ref, issuedAt: verified.issuedAt };
  }
  restartAllowed(lock, credential) { return !lock.restart || lock.restart.ref !== credential.ref; }
  destination(value) { if (!httpsOrigin(value) || value === this.issuer) fail('invalid_destination', 'Name the new provider by its https origin.'); return value; }
  /** Notice channels at the start of a move (spec §6.1(a)/(b)). Copies, never references (as deletion R1-M2). */
  async channels(owner, identity, { removed = false, now }) {
    const push = [...(await this.metadata.list({ prefix: `push-subscription/${encodeURIComponent(owner)}/` })).values()].filter(row => row?.owner === owner && typeof row.endpoint === 'string' && plain(row.keys)).slice(0, MAX_PUSH).map(row => ({ id: row.id, endpoint: row.endpoint, keys: structuredClone(row.keys) }));
    const removedEmails = removed ? (identity.removedEmails ?? []).filter(entry => now - entry.removedAt < TIMING.removedChannels && entry.address !== identity.email?.address).slice(0, 8) : [];
    return { email: identity.email ? { address: identity.email.address, verifiedAt: identity.email.verifiedAt } : null, removedEmails, push,
      sessions: identity.sessions.map(session => ({ id: session.id, createdAt: session.createdAt })), passkeys: identity.credentials.map(credential => ({ id: credential.id, createdAt: credential.createdAt })) };
  }
  noticeTargets(record) {
    const out = [], channels = record.channels; if (!channels) return out;
    if (channels.email) out.push({ kind: 'email', id: channels.email.address, email: channels.email.address, contestOnly: false });
    for (const entry of channels.removedEmails ?? []) out.push({ kind: 'email', id: entry.address, email: entry.address, contestOnly: entry.detached === true });
    for (const subscription of channels.push ?? []) out.push({ kind: 'push', id: subscription.id, push: subscription, contestOnly: false });
    return out;
  }

  // ---- begin and authorize ----

  /** Path (a), step 1. Owner with a fresh step-up. `input`: {destination, redirect}. Records a short draft. */
  async begin(actor, input) {
    const owner = ownerActor(actor), v = exact(input, ['destination', 'redirect']), now = this.now();
    if (!transferEnabled(this.flags, owner)) notFound();
    stepUp(actor, now);
    const destination = this.destination(v.destination); if (v.redirect !== undefined && typeof v.redirect !== 'boolean') fail('invalid_request', 'Choose whether old links redirect.');
    await this.eligible(owner, { now, actor });
    const draft = { v: 1, id: this.random.uuid(), owner, state: 'draft', destination, redirect: v.redirect !== false, createdAt: now, expiresAt: now + TIMING.draftTtl, requester: requester(actor), revision: 1 };
    await this.metadata.transaction(async tx => { const live = await tx.get(TRANSFER_KEY); if (live && (LIVE.has(live.state) || ['contested', 'committed'].includes(live.state))) fail('transfer_pending', 'A move is already pending for this identity.', 409); await tx.put(TRANSFER_KEY, draft); });
    this.log({ action: 'transfer-begun', owner });
    return transferView(draft);
  }
  /** Path (a), confirmation (spec §6.1 items 2, 3(a), 5). `input`: {draft, recoveryToken, keychain, confirm, remove?}.
   * `remove` is a requester-side elevated restart (P17): it names the devices and emails that aborted a previous move. */
  async authorize(actor, input) {
    const owner = ownerActor(actor), v = exact(input, ['draft', 'recoveryToken', 'keychain', 'confirm', 'remove']), now = this.now();
    if (!transferEnabled(this.flags, owner)) notFound();
    stepUp(actor, now);
    if (v.confirm !== true) fail('confirmation_required', 'Confirm that 3sln.me will stop speaking for you.');
    const draft = await this.metadata.get(TRANSFER_KEY);
    if (draft?.state !== 'draft' || draft.id !== v.draft || draft.expiresAt <= now) fail('draft_expired', 'Start the move again.', 409);
    const { identity, lock } = await this.eligible(owner, { now, actor });
    const credential = await this.credential(owner, identity, v, now);
    const elevated = v.remove !== undefined;
    if (!elevated && !this.restartAllowed(lock, credential)) fail('restart_blocked', 'Choose whether to reissue your recovery file before starting again.', 409);
    let security = identity.security, channels = await this.channels(owner, identity, { now });
    if (elevated) ({ security, channels } = await this.removeNamed(owner, identity, channels, v.remove, { lookback: true }));
    return this.create(owner, { path: 'a', destination: draft.destination, redirect: draft.redirect, credential, security, channels, now, requester: requester(actor), delay: elevated ? TIMING.freshDelay : TIMING.personDelay, elevated, draft });
  }
  /** Path (b) (spec §6.1(b), design §3.3): the current credential without a session starts a 7-day public waiting
   * period. Actor {kind:'credential', owner}. `input`: {recoveryToken, keychain, destination, redirect, confirm}. */
  async authorizeWaiting(actor, input) {
    if (actor?.kind !== 'credential' || !isUUID(actor.owner)) fail('unauthorized', 'Load your recovery file to continue.', 401);
    const owner = actor.owner, v = exact(input, ['recoveryToken', 'keychain', 'destination', 'redirect', 'confirm']), now = this.now();
    if (!transferEnabled(this.flags, owner)) notFound();
    if (v.confirm !== true) fail('confirmation_required', 'Confirm that 3sln.me will stop speaking for you.');
    const destination = this.destination(v.destination); if (v.redirect !== undefined && typeof v.redirect !== 'boolean') fail('invalid_request', 'Choose whether old links redirect.');
    // A path (b) requester has no session credential, so inside an elevated-abort contest window it is "another credential".
    const { identity, lock } = await this.eligible(owner, { now, actor: { kind: 'credential' } });
    const credential = await this.credential(owner, identity, v, now);
    if (!this.restartAllowed(lock, credential)) fail('restart_blocked', 'Choose whether to reissue your recovery file before starting again.', 409);
    const channels = await this.channels(owner, identity, { removed: true, now });
    if (!channels.email && !channels.removedEmails.length && !channels.push.length) fail('notice_channel_required', 'A waiting-period move needs an email address or a device that can receive notices.', 409);
    return this.create(owner, { path: 'b', destination, redirect: v.redirect !== false, credential, security: identity.security, channels, now, requester: { sessionId: null, credentialId: null }, delay: TIMING.waitingPeriod, elevated: false });
  }
  async create(owner, { path, destination, redirect, credential, security, channels, now, requester, delay, elevated, draft }) {
    const record = { v: 1, id: this.random.uuid(), owner, kind: 'person', path, state: 'pending', destination, redirect,
      transfer: { id: base64url(this.random.bytes(24)), exp: seconds(now + TIMING.expiry) }, createdAt: now, begunAt: now, expiresAt: now + TIMING.expiry,
      delay, noticedAt: null, round: 1, credential, securityEpoch: security.epoch, requester, channels, tokens: [], notices: {}, statement: null,
      disputes: [], hold: null, elevated: elevated ? { side: 'requester', at: now, credentialId: requester.credentialId ?? null, restart: true } : null,
      attestation: null, committedAt: null, redirectUntil: null, exportUntil: null, movedUntil: null, stages: {}, revision: 1 };
    await this.metadata.transaction(async tx => {
      const live = await tx.get(TRANSFER_KEY);
      if (draft && (live?.id !== draft.id || live.state !== 'draft')) fail('draft_expired', 'Start the move again.', 409);
      if (!draft && live && (LIVE.has(live.state) || ['contested', 'committed'].includes(live.state))) fail('transfer_pending', 'A move is already pending for this identity.', 409);
      await tx.put(TRANSFER_KEY, record);
      const lock = (await tx.get(LOCK_KEY)) ?? {}; if (lock.restart) { delete lock.restart; if (Object.keys(lock).length) await tx.put(LOCK_KEY, lock); else await tx.delete(LOCK_KEY); }
    });
    this.log({ action: 'transfer-authorized', owner, path, elevated });
    let current = await this.sendNotices(record, 'pending') ?? record;
    await this.arm(this.nextWake(current));
    return transferView(current, { now: this.now() });
  }

  // ---- notices ----

  /** Sends the round's notice to every target that has not accepted it, with a fresh dispute token per target whose
   * hash is committed before delivery. `noticedAt` is set once every target was tried and at least one accepted. */
  async sendNotices(record, kind) {
    let current = record; const notices = this.ports.notices;
    const targets = this.noticeTargets(current), now = this.now();
    if (!targets.length) { if (current.noticedAt === null) current = await this.update(current, r => { r.noticedAt = now; return r; }) ?? current; return current; }
    if (typeof notices?.deliver !== 'function') return current;
    for (const target of targets) {
      const slot = `${current.round}:${channelKey(target)}`, entry = current.notices[slot];
      if (entry?.accepted || (entry?.nextAt ?? 0) > now) continue;
      const token = this.token(), hash = await sha256(`transfer-dispute\0${token}`);
      current = await this.update(current, r => { if (!LIVE.has(r.state)) return null; r.tokens = [...r.tokens.filter(t => !(t.channel.kind === target.kind && t.channel.id === target.id)), { hash, channel: { kind: target.kind, id: target.id }, contestOnly: target.contestOnly, round: r.round }].slice(-MAX_TOKENS); return r; });
      if (!current) return null;
      const attempts = (entry?.attempts ?? 0) + 1; let accepted = false;
      try { accepted = (await notices.deliver({ owner: current.owner, kind, round: current.round, path: current.path, destination: current.destination, notBefore: notBefore(current), delayHours: Math.round(current.delay / HOUR), channel: target.email ? { email: target.email } : { push: target.push }, disputeToken: token, attemptId: `${current.id}:${slot}:${attempts}` }))?.accepted === true; } catch { accepted = false; }
      const at = this.now();
      current = await this.update(current, r => { r.notices = { ...r.notices, [slot]: { attempts, accepted, at, ...accepted ? {} : { nextAt: at + Math.min(6 * HOUR, 15 * MINUTE * 2 ** Math.min(attempts - 1, 5)) } } }; return r; }) ?? current;
      this.log({ action: 'transfer-notice', owner: current.owner, kind, accepted });
    }
    const tried = targets.every(target => current.notices[`${current.round}:${channelKey(target)}`]), any = targets.some(target => current.notices[`${current.round}:${channelKey(target)}`]?.accepted);
    if (current.noticedAt === null && tried && any) current = await this.update(current, r => { if (r.noticedAt === null) r.noticedAt = this.now(); return r; }) ?? current;
    return current;
  }
  /** Informational notices (cancelled, committed): best effort, no tokens, never retried beyond one pass. */
  async inform(record, kind) {
    const notices = this.ports.notices; if (typeof notices?.deliver !== 'function') return false;
    let accepted = false;
    for (const target of this.noticeTargets(record)) { try { accepted = (await notices.deliver({ owner: record.owner, kind, round: record.round, path: record.path, destination: record.destination, notBefore: null, delayHours: 0, channel: target.email ? { email: target.email } : { push: target.push }, attemptId: `${record.id}:${kind}:${channelKey(target)}` }))?.accepted === true || accepted; } catch {} }
    return accepted;
  }

  // ---- statement (spec §5.2) ----

  /** The move endpoint. System actor. `input`: {statement, transfer, redirect_base}. Returns the §5.2 body
   * {status:'attested'|'pending'|'refused', ...}; every refusal is the uniform `refused`. */
  async statement(actor, input) {
    if (actor?.kind !== 'system' || !isUUID(actor.owner)) fail('forbidden', 'Move statements require a system actor.', 403);
    return this.serial(() => this.statementOnce(actor.owner, input));
  }
  async statementOnce(owner, input) {
    const refused = { status: 'refused' };
    let v; try { v = exact(input, ['statement', 'transfer', 'redirect_base']); } catch { return refused; }
    let parsed, digest; try { parsed = parseMoveStatement(v.statement); digest = await statementDigest(parsed.input); } catch { return refused; }
    if (parsed.payload.sub !== owner || await this.metadata.get('owner') !== owner) return refused;
    if (!transferBackground(this.flags, owner)) return { status: 'unavailable' };
    let record = await this.metadata.get(TRANSFER_KEY);
    // Idempotent per statement: an attested statement returns the same attestation for as long as it is kept.
    if (record?.state === 'committed') return record.statement?.digest === digest && record.statement.redirectBase === v.redirect_base ? this.attested(record) : refused;
    const pendingAnswer = () => ({ status: 'pending', authorize_url: `${this.issuer}/account/transfer-out`, retry_after: 3600 });
    if (!record || !LIVE.has(record.state)) {
      // Cancellation and expiry discard the authorization; its statement and transfer are then refused (spec §6.2).
      if (record?.state === 'contested' || record && TERMINAL.has(record.state) && (record.statement?.digest === digest || v.transfer === record.transfer?.id)) return refused;
      // A statement without an authorization creates no state (IP-R1-H3); a structurally valid one learns where to go.
      return await this.verifiedNow(owner, parsed) ? pendingAnswer() : refused;
    }
    const now = this.now();
    if (record.statement) {
      if (record.statement.digest !== digest || record.statement.redirectBase !== v.redirect_base) return refused;
    } else {
      if (now >= record.expiresAt) return refused;
      if (!await this.statementBinds(record, parsed, v, now)) return refused;
      record = await this.update(record, r => { if (!LIVE.has(r.state) || r.statement) return null; r.statement = { jws: parsed.value, digest, redirectBase: v.redirect_base, to: parsed.payload.to, kid: parsed.header.kid, at: now }; return r; });
      if (!record) return refused;
      this.log({ action: 'transfer-statement-bound', owner });
    }
    const outcome = await this.advance(record);
    if (outcome.record?.state === 'committed') return this.attested(outcome.record);
    if (!outcome.record || !LIVE.has(outcome.record.state)) return refused;
    const at = notBefore(outcome.record);
    return { status: 'pending', authorize_url: `${this.issuer}/account/transfer-out`, retry_after: Math.max(60, Math.min(86400, at === null ? 3600 : Math.ceil((at - this.now()) / 1000))) };
  }
  attested(record) { return { status: 'attested', attestation: record.attestation, redirect_until: record.redirectUntil === null ? null : seconds(record.redirectUntil) }; }
  async verifiedNow(owner, parsed) {
    try { const key = await this.port('keys').current(owner); if (!key || key.kid !== parsed.header.kid) return false; await verifyMoveStatement(parsed.value, key.publicJwk); return true; } catch { return false; }
  }
  /** §6.1 item 1 binding (IP-R1-H3) against the source's own records. */
  async statementBinds(record, parsed, v, now) {
    const s = parsed.payload, issuer = this.issuer;
    if (s.kind !== record.kind || s.seq !== 1 || s.prev !== null || s.from.iss !== issuer || s.from.identity !== identityURI(issuer, record.owner) || s.to.iss !== record.destination) return false;
    try { validateRedirectBase(v.redirect_base, record.destination); } catch { return false; }
    if (v.transfer !== record.transfer.id) return false;
    if (s.iat * 1000 < record.createdAt - TIMING.statementSkew || s.iat * 1000 > now + TIMING.statementSkew) return false;
    return this.verifiedNow(record.owner, parsed);
  }

  // ---- the state machine ----

  /** Automatic cancellation and expiry checks, then notices, then commit when everything allows it. */
  async advance(record) {
    let current = record; const now = this.now(), owner = current.owner;
    if (current.state === 'held') {
      if (now >= current.hold.expiresAt) return { record: await this.end(current, 'aborted', 'hold-expired', { block: true }), action: 'aborted' };
      return { record: current, action: 'held', wakeAt: current.hold.expiresAt };
    }
    if (current.state !== 'pending') return { record: current, action: current.state };
    const reason = await this.cancelReason(current, now);
    if (reason) return { record: await this.end(current, 'cancelled', reason, { block: reason !== 'deletion' }), action: 'cancelled', reason };
    if (!current.statement && now >= current.expiresAt) return { record: await this.end(current, 'expired', 'no-statement'), action: 'expired' };
    current = await this.sendNotices(current, current.round === 1 ? 'pending' : 'restarted') ?? current;
    if (current.state !== 'pending') return { record: current, action: current.state };
    const at = notBefore(current);
    if (!current.statement || at === null || now < at) return { record: current, action: 'wait', wakeAt: this.nextWake(current) };
    if (!transferBackground(this.flags, owner)) return { record: current, action: 'killed', wakeAt: now + HOUR };
    let held; try { held = (await this.port('hold')(owner))?.held !== false; } catch { held = true; }
    if (held) { this.log({ action: 'transfer-hold', owner, reason: 'admin-hold' }); return { record: current, action: 'hold', reason: 'admin-hold', wakeAt: now + HOUR }; }
    const attestor = this.ports.attestor;
    if (!attestor || typeof attestor.sign !== 'function') { this.log({ action: 'transfer-hold', owner, reason: 'attestor-unconfigured' }); return { record: current, action: 'hold', reason: 'attestor-unconfigured', wakeAt: now + HOUR }; }
    return this.commit(current, attestor);
  }
  /** Spec §6.1 re-checks and design §6.1: what ends a pending move without anyone asking. */
  async cancelReason(record, now) {
    if (await this.metadata.get(TOMBSTONE) !== undefined) return 'deletion';
    const request = await this.metadata.get(DELETION_REQUEST);
    if (['scheduled', 'executing'].includes(request?.state) || await this.metadata.get(DELETION_FENCE) !== undefined || await this.metadata.get(PURGE) !== undefined) return 'deletion';
    let identity; try { identity = await this.port('identity').get(record.owner); } catch { return null; }
    if (!identity || identity.status !== 'active') return 'identity-inactive';
    if (identity.security.epoch !== record.securityEpoch) return 'security-change';
    if (identity.recovery?.ref !== record.credential.ref || identity.recovery?.issuedAt !== record.credential.issuedAt) return 'credential-superseded';
    // Path (b): any fresh sign-in during the period cancels it (spec §6.1(b); design §6.1a item 4).
    if (record.path === 'b' && identity.sessions.some(session => session.createdAt > record.begunAt)) return 'sign-in';
    if (record.statement) { let key; try { key = await this.port('keys').current(record.owner); } catch { return null; } if (key && key.kid !== record.statement.kid) return 'key-rotated'; }
    return null;
  }
  async end(record, state, reason, { block = false } = {}) {
    const now = this.now();
    const next = await this.patch(record.id, r => { if (!LIVE.has(r.state) && r.state !== 'contested') return null; Object.assign(r, { state, reason, endedAt: now, tokens: [], hold: null }); return r; });
    if (!next) return this.metadata.get(TRANSFER_KEY);
    if (block) await this.setLock(lock => ({ ...lock, restart: { ref: next.credential.ref, at: now, reason } }));
    this.log({ action: `transfer-${state}`, owner: next.owner, reason });
    await this.inform(next, 'cancelled');
    // The copied channel snapshot (addresses, push endpoints) is dropped once the last notice went out.
    return await this.patch(next.id, r => { if (!TERMINAL.has(r.state)) return null; r.channels = null; r.notices = {}; return r; }) ?? next;
  }
  nextWake(record) {
    const now = this.now(), times = [];
    if (!record) return null;
    if (record.state === 'held') times.push(record.hold.expiresAt);
    if (record.state === 'pending') {
      if (!record.statement) times.push(record.expiresAt);
      const at = notBefore(record); if (at !== null) times.push(at);
      for (const entry of Object.values(record.notices ?? {})) if (!entry.accepted && time(entry.nextAt)) times.push(entry.nextAt);
      if (record.noticedAt === null) times.push(now + 15 * MINUTE);
    }
    if (record.state === 'committed') { if (COMMIT_STAGES.some(stage => !record.stages[stage])) times.push(now + MINUTE); else times.push(record.exportUntil); }
    const future = times.filter(t => time(t)).map(t => Math.max(t, now + 1000));
    return future.length ? Math.min(...future, now + DAY) : null;
  }

  // ---- commit (spec §6.3; design §6.3) ----

  async commit(record, attestor) {
    const owner = record.owner, now = this.now();
    let identity; try { identity = await this.port('identity').get(owner); } catch { return { record, action: 'hold', reason: 'identity-unavailable', wakeAt: now + HOUR }; }
    if (!identity || identity.status !== 'active') return { record: await this.end(record, 'cancelled', 'identity-inactive', { block: true }), action: 'cancelled' };
    const s = record.statement, redirectUntil = record.redirect ? now + TIMING.redirect : null, exportUntil = now + TIMING.exportWindow;
    const movedUntil = Math.max(redirectUntil ?? 0, now + TIMING.attestationRetention);
    let attestation;
    try {
      attestation = await attestor.sign({ bindle: 'move-attestation', v: 1, iss: this.issuer, sub: owner, seq: 1, statement: s.digest, to: s.to, aep: identity.security.epoch, at: seconds(now) });
    } catch { this.log({ action: 'transfer-hold', owner, reason: 'attestation-failed' }); return { record, action: 'hold', reason: 'attestation-failed', wakeAt: now + HOUR }; }
    // One account commit. Everything the transaction re-reads decides against a deletion, cancellation or dispute
    // that committed first (spec §6.2: serialized in the identity's single writer). An attestation signed for a commit
    // that loses is discarded unreturned.
    const committed = await this.metadata.transaction(async tx => {
      const live = await tx.get(TRANSFER_KEY);
      if (live?.id !== record.id || live.revision !== record.revision || live.state !== 'pending') return null;
      const request = await tx.get(DELETION_REQUEST);
      if (['scheduled', 'executing'].includes(request?.state) || await tx.get(DELETION_FENCE) !== undefined || await tx.get(PURGE) !== undefined || await tx.get(TOMBSTONE) !== undefined) return null;
      const next = { ...live, state: 'committed', attestation, committedAt: now, redirectUntil, exportUntil, movedUntil, aep: identity.security.epoch, tokens: [], hold: null, stages: {}, revision: live.revision + 1 };
      await tx.put(TRANSFER_KEY, next); return next;
    });
    if (!committed) { const fresh = await this.metadata.get(TRANSFER_KEY); return { record: fresh, action: 'retry', wakeAt: now + 1000 }; }
    this.log({ action: 'transfer-committed', owner, path: committed.path });
    const after = await this.stages(committed);
    return { record: after, action: 'committed', wakeAt: this.nextWake(after) };
  }
  /** Post-commit effects, each idempotent and recorded. A failing stage retries on the next step. */
  async stages(record) {
    let current = record; const owner = current.owner, ports = this.ports, effects = ports.effects ?? {};
    const run = async (stage, work) => {
      if (current.stages[stage]) return true;
      let evidence; try { evidence = await work(); } catch (error) { this.log({ action: 'transfer-stage-retry', owner, stage, code: error?.code ?? 'unavailable' }); return false; }
      if (evidence === false) return false;
      current = await this.patch(current.id, r => { if (r.state !== 'committed') return null; r.stages = { ...r.stages, [stage]: { at: this.now(), ...plain(evidence) ? evidence : {} } }; return r; }) ?? current;
      return true;
    };
    // 1. Stop speaking for the identity: status `moved` ends every session and refuses recovery and credentials.
    if (!await run('identity', async () => { const moved = movedRecord(current, this.issuer); const result = await this.port('identity').markMoved(owner, { moved }); if (result?.ok !== true) throw Object.assign(new Error('identity not moved'), { code: result?.status ?? 'identity_unavailable' }); return { status: 'moved' }; })) return current;
    // 2. Destroy the custody copies of the private keys (public records stay published).
    await run('keys', async () => { await this.port('keys').destroy(owner); return { destroyed: true }; });
    // 3. Key delegations died at commit; status answers `revoked` from this host (spec §6.3, §10).
    await run('delegations', async () => { if (typeof effects.revokeDelegations !== 'function') return { absent: true }; await effects.revokeDelegations(owner); return { revoked: true }; });
    // 4. Sever every connection (terminal connection-revoked, never subject-deleted; AR-9).
    await run('connections', async () => { if (typeof effects.severConnections !== 'function') return { absent: true }; await effects.severConnections(owner); return { severed: true }; });
    // 5. App grants, token families and MCP grants: a moved identity's credentials then fail uniformly.
    await run('grants', async () => { if (typeof effects.eraseGrants !== 'function') return { absent: true }; return { ...await effects.eraseGrants(owner) ?? {}, erased: true }; });
    // 6. Scheduler backstop: the redirect and proof end (`movedUntil`), and the purge after the export window.
    await run('due', async () => { const due = ports.due; if (!due || typeof due.put !== 'function') return { absent: true }; await due.put(owner, current.movedUntil, 'moved-end'); await due.put(owner, current.exportUntil, 'tick'); return { indexed: true }; });
    // 7. Completion notice, informational (spec §6.3 SHOULD). Acceptance is recorded, never delivery.
    await run('notice', async () => ({ accepted: await this.inform(current, 'committed') }));
    if (current.stages.notice && current.channels) current = await this.patch(current.id, r => { if (r.state !== 'committed') return null; r.channels = null; r.notices = {}; return r; }) ?? current;
    return current;
  }

  // ---- owner, link and support actions ----

  /** Withdraw or cancel. Owner (any signed-in session; the safe direction), credential (a path (b) requester
   * withdrawing with the same file) or system. Cancellation and commit are serialized here (spec §6.2). */
  async cancel(actor, input) {
    return this.serial(async () => {
      const owner = actor?.owner; if (!['owner', 'credential', 'system'].includes(actor?.kind) || !isUUID(owner)) fail('unauthorized', 'Sign in to continue.', 401);
      await this.bound(owner);
      const record = await this.metadata.get(TRANSFER_KEY);
      if (record?.state === 'draft') { await this.metadata.transaction(async tx => { const live = await tx.get(TRANSFER_KEY); if (live?.id === record.id && live.state === 'draft') await tx.delete(TRANSFER_KEY); }); return { state: 'none' }; }
      if (!record || !LIVE.has(record.state)) { if (record?.state === 'committed') fail('transfer_committed', 'This identity has already moved.', 410); return transferView(record); }
      if (actor.kind === 'credential') {
        const v = exact(input, ['recoveryToken']); const verified = await this.port('identity').verifyRecovery(owner, v.recoveryToken);
        if (!verified || verified.ref !== record.credential.ref) fail('recovery_invalid', 'This recovery file cannot withdraw this move.', 400);
      } else exact(input, []);
      const requesterWithdraws = actor.kind === 'credential' || actor.kind === 'owner' && actor.sessionId !== undefined && actor.sessionId === record.requester.sessionId;
      return transferView(await this.end(record, 'cancelled', actor.kind === 'system' ? 'system' : requesterWithdraws ? 'withdrawn' : 'owner-cancelled', { block: !requesterWithdraws }));
    });
  }
  /** Tier 0 (P17): a known device or confirmed email holds or aborts. Actor {kind:'dispute-link', owner} with
   * input {token, choice}, or {kind:'owner', owner, sessionId, sessionCreatedAt, credentialCreatedAt?} with {choice}. */
  async dispute(actor, input) {
    return this.serial(async () => {
      const owner = actor?.owner, now = this.now();
      if (!['dispute-link', 'owner'].includes(actor?.kind) || !isUUID(owner)) fail('unauthorized', 'Sign in to continue.', 401);
      const link = actor.kind === 'dispute-link', invalid = () => fail('invalid_token', 'This link is no longer valid.', 400);
      const v = exact(input, link ? ['token', 'choice'] : ['choice']);
      if (!['hold', 'abort'].includes(v.choice)) fail('invalid_request', 'Choose to hold or abort the move.');
      if (await this.metadata.get('owner') !== owner) link ? invalid() : await this.bound(owner);
      const record = await this.metadata.get(TRANSFER_KEY);
      if (!record || !LIVE.has(record.state)) return link ? invalid() : transferView(record);
      let by;
      if (link) {
        if (typeof v.token !== 'string' || !TOKEN.test(v.token)) invalid();
        const hash = await sha256(`transfer-dispute\0${v.token}`), entry = record.tokens.find(t => secureEqual(t.hash, hash)); if (!entry) invalid();
        by = { kind: entry.channel.kind, id: entry.channel.id, contestOnly: entry.contestOnly === true };
      } else {
        // Devices added after the move began cannot dispute (design §6.1a item 2).
        const known = time(actor.sessionCreatedAt) && actor.sessionCreatedAt < record.begunAt || time(actor.credentialCreatedAt) && actor.credentialCreatedAt < record.begunAt;
        if (!known) fail('dispute_not_allowed', 'Only a device or email you had before this move began can dispute it.', 403);
        by = { kind: 'session', id: actor.sessionId ?? null, contestOnly: false };
      }
      const disputes = [...record.disputes, { at: now, by: { kind: by.kind, id: by.id }, choice: v.choice }].slice(-MAX_DISPUTES);
      // After a requester-side elevated resolution or restart, or a support decision, there is no second
      // self-resolution: any dispute (including one through a detached email's link) goes to support.
      if (by.contestOnly || record.elevated) {
        const contested = await this.contest(record, 'dispute-after-elevated-resolution', now, { disputes });
        return link ? { state: 'contested' } : transferView(contested);
      }
      if (v.choice === 'abort') {
        const patched = await this.patch(record.id, r => { if (!LIVE.has(r.state)) return null; r.disputes = disputes; return r; }) ?? record;
        const ended = await this.end(patched, 'aborted', 'disputed', { block: true });
        return link ? { state: 'aborted', recoveryReissueOffered: true } : { ...transferView(ended), recoveryReissueOffered: true };
      }
      const held = await this.patch(record.id, r => { if (!LIVE.has(r.state)) return null; r.disputes = disputes; if (r.state !== 'held') { r.state = 'held'; r.hold = { at: now, by: { kind: by.kind, id: by.id }, expiresAt: now + TIMING.holdExpiry }; } return r; }) ?? record;
      this.log({ action: 'transfer-held', owner });
      await this.arm(this.nextWake(held));
      return link ? { state: held.state } : transferView(held);
    });
  }
  /** Locks transfer-out for support (P17 "contested"). `record` may be null (a conflicting request with no move). */
  async contest(record, reason, now, { disputes } = {}) {
    let next = null;
    if (record) next = await this.patch(record.id, r => { if (!LIVE.has(r.state)) return null; Object.assign(r, { state: 'contested', reason, contestedAt: now, tokens: [], ...disputes ? { disputes } : {} }); return r; });
    await this.setLock(lock => ({ ...lock, contested: { since: now, until: null, reason } }));
    this.log({ action: 'transfer-contested', owner: record?.owner, reason });
    return next ?? record;
  }
  /** Tier 1 elevated proof (P17). Owner with a fresh step-up. `input`: {side:'requester'|'disputer', recoveryToken,
   * keychain, remove?:{sessions, passkeys, emails, push}}. */
  async elevate(actor, input) {
    return this.serial(async () => {
      const owner = ownerActor(actor), v = exact(input, ['side', 'recoveryToken', 'keychain', 'remove']), now = this.now();
      stepUp(actor, now); await this.bound(owner);
      if (!['requester', 'disputer'].includes(v.side)) fail('invalid_request', 'Choose which side this proof is for.');
      const record = await this.metadata.get(TRANSFER_KEY);
      if (!record || !LIVE.has(record.state)) fail('transfer_not_pending', 'There is no pending move to resolve.', 409);
      const identity = await this.port('identity').get(owner);
      if (!identity || identity.status !== 'active') fail('account_not_active', 'Moving is not available for this account.', 409);
      const credential = await this.credential(owner, identity, v, now);
      // (iii) no authority reset since the move began (the move itself required none in the 7 days before it).
      if (identity.security.epoch !== record.securityEpoch || credential.ref !== record.credential.ref) fail('elevated_proof_insufficient', 'This proof is not strong enough to resolve the dispute.', 403);
      const lock = await this.lock();
      if (lock.elevatedAbort && now - lock.elevatedAbort.at < TIMING.contestWindow && !sameCredential(lock.elevatedAbort, actor)) return transferView(await this.contest(record, 'elevated-proof-after-elevated-abort', now));
      // Elevated proof on both sides of the same move goes to support; so does a second self-resolution.
      if (record.elevated) return transferView(await this.contest(record, 'elevated-proof-both-sides', now));
      if (v.side === 'disputer') {
        if (v.remove !== undefined) fail('invalid_request', 'The disputing side names no devices.');
        const marked = await this.patch(record.id, r => { if (!LIVE.has(r.state)) return null; r.elevated = { side: 'disputer', at: now, credentialId: actor.credentialId ?? null }; return r; }) ?? record;
        const ended = await this.end(marked, 'aborted', 'elevated-dispute');
        // The requester's copy stops being current in the same action (mandatory reissue).
        // It also arms the forced reissue for the owner (recovery-identity spec "Active-account reissue").
        let reissue = false; try { reissue = (await this.port('identity').invalidateRecovery(owner, { reason: 'elevated-abort' }))?.ok === true; } catch { reissue = false; }
        await this.setLock(l => ({ ...l, elevatedAbort: { at: now, credentialId: actor.credentialId ?? null, sessionId: actor.sessionId ?? null }, restart: undefined }));
        return { ...transferView(ended), recoveryReissueRequired: true, recoveryInvalidated: reissue };
      }
      if (record.path !== 'a') fail('elevated_proof_unavailable', 'A waiting-period move is resolved only by support or by withdrawing it.', 409);
      if (v.remove === undefined) fail('invalid_request', 'Name the devices and emails that disputed this move.');
      const { security, channels, removed } = await this.removeNamed(owner, identity, record.channels, v.remove, { lookback: false, expectedEpoch: record.securityEpoch });
      const next = await this.patch(record.id, r => {
        if (!LIVE.has(r.state)) return null;
        const gone = new Set([...removed.sessions.map(id => `session:${id}`), ...removed.passkeys.map(id => `passkey:${id}`), ...removed.push.map(id => `push:${id}`)]);
        Object.assign(r, { state: 'pending', hold: null, securityEpoch: security.epoch, channels, delay: TIMING.freshDelay, noticedAt: null, round: r.round + 1,
          elevated: { side: 'requester', at: now, credentialId: actor.credentialId ?? null, removed },
          tokens: r.tokens.filter(t => !gone.has(channelKey(t.channel))).map(t => t.channel.kind === 'email' && removed.emails.includes(t.channel.id) ? { ...t, contestOnly: true } : t) });
        return r;
      });
      if (!next) fail('transfer_not_pending', 'There is no pending move to resolve.', 409);
      this.log({ action: 'transfer-elevated', owner, side: 'requester' });
      const notified = await this.sendNotices(next, 'restarted') ?? next;
      await this.arm(this.nextWake(notified));
      return transferView(notified, { now: this.now() });
    });
  }
  /** Removes named sessions, passkeys and push devices and detaches named emails (P17). Detached emails stay notice
   * targets for 30 days and can only escalate to support. Returns the new security state as the move's baseline. */
  async removeNamed(owner, identity, channels, remove, { lookback, expectedEpoch } = {}) {
    const r = exact(remove, ['sessions', 'passkeys', 'emails', 'push']), list = (value, max) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item || item.length > 256)) fail('invalid_request', 'Name devices and emails exactly.'); return [...new Set(value)]; };
    const named = { sessions: list(r.sessions, 16), passkeys: list(r.passkeys, 8), emails: list(r.emails, 8), push: list(r.push, MAX_PUSH) };
    if (!named.sessions.length && !named.passkeys.length && !named.emails.length && !named.push.length) fail('invalid_request', 'Name at least one device or email.');
    for (const id of named.sessions) if (!identity.sessions.some(s => s.id === id)) fail('unknown_device', 'One of the named devices is not on this account.', 409);
    for (const id of named.passkeys) if (!identity.credentials.some(c => c.id === id)) fail('unknown_device', 'One of the named devices is not on this account.', 409);
    for (const address of named.emails) if (identity.email?.address !== address) fail('unknown_email', 'One of the named emails is not on this account.', 409);
    const pushRows = [...(await this.metadata.list({ prefix: `push-subscription/${encodeURIComponent(owner)}/` })).entries()];
    for (const id of named.push) if (!pushRows.some(([, row]) => row?.id === id)) fail('unknown_device', 'One of the named devices is not on this account.', 409);
    if (lookback && this.now() - identity.security.changedAt < TIMING.securityLookback) fail('recent_security_change', 'Wait 7 days after a security change before moving your identity.', 409);
    const result = await this.port('identity').removeDisputers(owner, { sessions: named.sessions, passkeys: named.passkeys, emails: named.emails, expectedEpoch: expectedEpoch ?? identity.security.epoch });
    if (result?.ok !== true) fail('conflict', 'Your account changed; start this step again.', 409);
    for (const [path, row] of pushRows) if (named.push.includes(row?.id)) await this.metadata.delete(path);
    const now = this.now(), detached = named.emails.map(address => ({ address, removedAt: now, detached: true }));
    const next = { ...channels, email: channels.email && named.emails.includes(channels.email.address) ? null : channels.email,
      removedEmails: [...(channels.removedEmails ?? []).filter(entry => !named.emails.includes(entry.address)), ...detached],
      push: (channels.push ?? []).filter(row => !named.push.includes(row.id)), sessions: channels.sessions.filter(s => !named.sessions.includes(s.id)), passkeys: channels.passkeys.filter(p => !named.passkeys.includes(p.id)) };
    return { security: result.security, channels: next, removed: named };
  }
  /** Tier 2 (P17), audited by the caller: support aborts (optionally locking up to 30 days) or allows a contested move,
   * which then commits after a final 24 h notified delay, only if the requester still holds the current credential.
   * System actor. `input`: {decision:'abort'|'allow', operators:[ids], lockDays?}. */
  async support(actor, input) {
    return this.serial(async () => {
      if (actor?.kind !== 'system' || !isUUID(actor.owner)) fail('forbidden', 'Support decisions require a system actor.', 403);
      const owner = actor.owner, v = exact(input, ['decision', 'operators', 'lockDays']), now = this.now(); await this.bound(owner);
      if (!Array.isArray(v.operators) || v.operators.some(id => typeof id !== 'string' || !id || id.length > 128) || new Set(v.operators).size !== v.operators.length || !v.operators.length) fail('invalid_request', 'Name the deciding operators.');
      const record = await this.metadata.get(TRANSFER_KEY);
      if (v.decision === 'abort') {
        const days = v.lockDays ?? 0; if (!Number.isSafeInteger(days) || days < 0 || days * DAY > TIMING.supportLockMax) fail('invalid_request', 'Lock for at most 30 days.');
        if (record && (LIVE.has(record.state) || record.state === 'contested')) await this.end(record, 'aborted', 'support', { block: true });
        await this.setLock(lock => ({ ...lock, contested: days ? { since: lock.contested?.since ?? now, until: now + days * DAY, reason: 'support-abort', decidedAt: now, operators: v.operators } : undefined }));
        this.log({ action: 'transfer-support', owner, decision: 'abort', operators: v.operators.length });
        return transferView(await this.metadata.get(TRANSFER_KEY));
      }
      if (v.decision !== 'allow') fail('invalid_request', 'Choose abort or allow.');
      if (v.operators.length < 2) fail('second_operator_required', 'Allowing a contested move needs a second operator.', 403);
      if (record?.state !== 'contested') fail('transfer_not_contested', 'There is no contested move.', 409);
      const identity = await this.port('identity').get(owner);
      if (!identity || identity.status !== 'active' || identity.recovery?.ref !== record.credential.ref) fail('recovery_invalid', 'The requester no longer holds the current recovery credential.', 409);
      const next = await this.patch(record.id, r => { if (r.state !== 'contested') return null; Object.assign(r, { state: 'pending', securityEpoch: identity.security.epoch, delay: TIMING.finalDelay, noticedAt: null, round: r.round + 1, hold: null, support: { at: now, operators: v.operators }, elevated: r.elevated ? { ...r.elevated, supported: true, side: 'support' } : { side: 'support', at: now } }); if (!r.statement) r.expiresAt = Math.max(r.expiresAt, now + TIMING.expiry); return r; });
      await this.setLock(lock => ({ ...lock, contested: undefined }));
      this.log({ action: 'transfer-support', owner, decision: 'allow', operators: v.operators.length });
      const notified = await this.sendNotices(next, 'restarted') ?? next; await this.arm(this.nextWake(notified));
      return transferView(notified, { now: this.now() });
    });
  }
  /** After a dispute or automatic cancel, the owner chooses (spec §6.2): `reissue` invalidates the presented credential,
   * `keep` lifts the restart block. Owner with a fresh step-up. */
  async restartChoice(actor, input) {
    const owner = ownerActor(actor), v = exact(input, ['choice']), now = this.now(); stepUp(actor, now); await this.bound(owner);
    if (!['reissue', 'keep'].includes(v.choice)) fail('invalid_request', 'Choose whether to reissue your recovery file.');
    const lock = await this.lock(); if (!lock.restart) return { restartBlocked: false };
    let invalidated = false; if (v.choice === 'reissue') { try { invalidated = (await this.port('identity').invalidateRecovery(owner))?.ok === true; } catch { invalidated = false; } if (!invalidated) unavailable(); }
    await this.setLock(l => ({ ...l, restart: undefined }));
    return { restartBlocked: false, recoveryReissueRequired: v.choice === 'reissue' };
  }

  /** The recovery-file reissue gate (recovery-identity spec "Active-account reissue"; P14, P17), called by the account
   * single writer before a reissue rotates (`commit` false) and before its identity commit (`commit` true). Refuses a
   * committed move, a contested transfer and the support lock: support's allow needs the requester to still hold the
   * current file, so a reissue there would be the second self-resolution P17 forbids. Within 30 days after an
   * elevated-proof abort, a reissue by another credential is contested (P17) and refused. At commit, a pending or held
   * transfer is CANCELLED, never left to commit: it was authorized by the file being replaced, the new file is not
   * 7 days old (P14) and its security bump trips the 7-day look-back, so nothing is dodged; abort is the safe direction. */
  async recoveryReissue(actor, { commit = false } = {}) {
    return this.serial(async () => {
      const owner = ownerActor(actor), now = this.now(); await this.bound(owner);
      const record = await this.metadata.get(TRANSFER_KEY);
      if (record?.state === 'committed') fail('identity_moved', 'This identity moved to another provider.', 409);
      if (record?.state === 'contested') fail('transfer_contested', 'Your recovery file cannot be replaced while support reviews a move.', 423);
      const lock = await this.lock();
      if (lock.contested && (lock.contested.until === null || lock.contested.until > now)) fail('transfer_locked', 'Your recovery file cannot be replaced while support reviews a move.', 423);
      if (lock.elevatedAbort && now - lock.elevatedAbort.at < TIMING.contestWindow && !sameCredential(lock.elevatedAbort, actor)) { await this.contest(null, 'recovery-reissue-after-elevated-abort', now); fail('transfer_contested', 'Support must review this account before the recovery file is replaced.', 423); }
      const live = Boolean(record && LIVE.has(record.state));
      if (!commit) return { transferPending: live };
      if (!live) return { transferCancelled: false };
      const ended = await this.end(record, 'cancelled', 'recovery-reissued');
      return { transferCancelled: ended?.state === 'cancelled' };
    });
  }

  // ---- background ----

  /** One bounded step (alarm, sweep). Returns {action, wakeAt?, stop?, moved?}. System actor. */
  step(actor) {
    if (actor?.kind !== 'system' || !isUUID(actor.owner)) fail('forbidden', 'Transfer steps require a system actor.', 403);
    return this.serial(() => this.stepOnce(actor.owner));
  }
  async stepOnce(owner) {
    const record = await this.metadata.get(TRANSFER_KEY), now = this.now();
    if (!record || record.owner !== owner) return { action: 'none' };
    if (record.state === 'draft') { if (record.expiresAt <= now) await this.metadata.transaction(async tx => { const live = await tx.get(TRANSFER_KEY); if (live?.id === record.id && live.state === 'draft') await tx.delete(TRANSFER_KEY); }); return { action: 'none', wakeAt: record.expiresAt > now ? record.expiresAt : null }; }
    if (TERMINAL.has(record.state) || record.state === 'contested') return { action: record.state };
    if (record.state === 'committed') {
      const after = await this.stages(record);
      if (COMMIT_STAGES.some(stage => !after.stages[stage])) { const wakeAt = now + 5 * MINUTE; await this.arm(wakeAt); return { action: 'committed', moved: true, wakeAt }; }
      if (now < after.exportUntil) { await this.arm(after.exportUntil); return { action: 'export-window', moved: true, wakeAt: after.exportUntil }; }
      if (!transferBackground(this.flags, owner)) return { action: 'killed', moved: true, wakeAt: now + HOUR };
      const purge = this.ports.effects?.purge;
      if (typeof purge !== 'function') { this.log({ action: 'transfer-hold', owner, reason: 'purge-unconfigured' }); return { action: 'hold', moved: true, wakeAt: now + DAY }; }
      const batch = await purge(owner);
      if (batch?.done) { this.log({ action: 'transfer-purged', owner }); return { action: 'purged', moved: true, stop: true }; }
      const wakeAt = time(batch?.wakeAt) ? batch.wakeAt : batch?.halted ? now + HOUR : now + 2000; await this.arm(wakeAt);
      return { action: 'purging', moved: true, stop: true, wakeAt, ...batch?.hold ? { hold: batch.hold } : {} };
    }
    const outcome = await this.advance(record);
    const wakeAt = outcome.wakeAt ?? this.nextWake(outcome.record); if (wakeAt) await this.arm(wakeAt);
    return { action: outcome.action, ...outcome.reason ? { reason: outcome.reason } : {}, ...outcome.record?.state === 'committed' ? { moved: true } : {}, ...wakeAt ? { wakeAt } : {} };
  }
  async status(actor) {
    if (!['owner', 'system'].includes(actor?.kind) || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401);
    await this.bound(actor.owner);
    const view = transferView(await this.metadata.get(TRANSFER_KEY), { now: this.now() }), lock = await this.lock(), now = this.now();
    return { ...view, restartBlocked: Boolean(lock.restart), locked: Boolean(lock.contested && (lock.contested.until === null || lock.contested.until > now)) };
  }
}

function ownerActor(actor) { if (actor?.kind !== 'owner' || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401); return actor.owner; }
function stepUp(actor, now) { if (!time(actor.stepUpAt) || actor.stepUpAt > now || now - actor.stepUpAt >= TIMING.stepUp) fail('step_up_required', 'Confirm your password or passkey to continue.', 401); }
const requester = actor => ({ sessionId: typeof actor.sessionId === 'string' ? actor.sessionId : null, credentialId: typeof actor.credentialId === 'string' ? actor.credentialId : null });
/** Whether `actor` authenticates with the same credential that made an elevated-proof abort (the session's passkey,
 * or the same session for a password session). A step-up's own credential is not recorded by the identity service. */
const sameCredential = (entry, actor) => entry.credentialId ? entry.credentialId === actor?.credentialId : entry.sessionId !== null && entry.sessionId === actor?.sessionId;
/** The moved record written on the identity (design §6.5 item 3). */
export function movedRecord(record, issuer) {
  return { v: 1, from: { iss: issuer, identity: identityURI(issuer, record.owner) }, to: record.statement.to, redirectBase: record.redirect ? record.statement.redirectBase : null, boundRedirectBase: record.statement.redirectBase,
    statement: record.statement.jws, statementDigest: record.statement.digest, attestation: record.attestation, committedAt: record.committedAt,
    redirectUntil: record.redirectUntil, exportUntil: record.exportUntil, movedUntil: record.movedUntil };
}

// ---- engine operations ----------------------------------------------------------------------------------------
// The service is provided under the catalogued `lifecycle` name (as DX-3 deletion): transfer-out is an account
// lifecycle event and shares the purge executor. Actors are built by trusted adapters only, never from a body.
// Every operation is terms-exempt: leaving must never require accepting new terms.
const CHANGED = 'transfer-out-changed';
class TransferAction extends AppAction { static deps = ['lifecycle']; static changes = CHANGED; static termsGate = 'exempt'; }
export class BeginTransferOut extends TransferAction { static operation = 'transfer.begin'; run({ lifecycle }) { return lifecycle.begin(this.actor, this.input); } }
export class AuthorizeTransferOut extends TransferAction { static operation = 'transfer.authorize'; run({ lifecycle }) { return lifecycle.authorize(this.actor, this.input); } }
export class AuthorizeWaitingTransferOut extends TransferAction { static operation = 'transfer.authorize-waiting'; run({ lifecycle }) { return lifecycle.authorizeWaiting(this.actor, this.input); } }
export class ReceiveMoveStatement extends TransferAction { static operation = 'transfer.statement'; run({ lifecycle }) { return lifecycle.statement(this.actor, this.input); } }
export class CancelTransferOut extends TransferAction { static operation = 'transfer.cancel'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.cancel(this.actor, this.input); } }
export class DisputeTransferOut extends TransferAction { static operation = 'transfer.dispute'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.dispute(this.actor, this.input); } }
export class ElevateTransferOut extends TransferAction { static operation = 'transfer.elevate'; run({ lifecycle }) { return lifecycle.elevate(this.actor, this.input); } }
export class SupportTransferOut extends TransferAction { static operation = 'transfer.support'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.support(this.actor, this.input); } }
export class TransferRestartChoice extends TransferAction { static operation = 'transfer.restart-choice'; run({ lifecycle }) { return lifecycle.restartChoice(this.actor, this.input); } }
export class StepTransferOut extends TransferAction { static operation = 'transfer.step'; static lifecycle = 'purging'; run({ lifecycle }) { return lifecycle.step(this.actor); } }
export class TransferOutStatus extends AppQuery { static operation = 'transfer.status'; static deps = ['lifecycle']; static refreshOn = [CHANGED]; static lifecycle = 'suspended'; static termsGate = 'exempt'; fetch({ lifecycle }) { return lifecycle.status(this.actor); } }
export const TRANSFER_OUT_OPERATIONS = Object.freeze([BeginTransferOut, AuthorizeTransferOut, AuthorizeWaitingTransferOut, ReceiveMoveStatement, CancelTransferOut, DisputeTransferOut, ElevateTransferOut, SupportTransferOut, TransferRestartChoice, StepTransferOut, TransferOutStatus]);

// ---- identity port over the identity repository ---------------------------------------------------------------

const RECOVERY_TOKEN = /^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/;
/** Trusted transfer-out identity port (never an HTTP operation) over any identity repository with get and
 * compareAndSwap (the Node IdentityRepository, the Worker ShardedIdentityRepository). */
export function transferIdentityPort(repository, { clock = () => Date.now(), crypto: webCrypto = globalThis.crypto } = {}) {
  if (typeof repository?.get !== 'function' || typeof repository.compareAndSwap !== 'function') throw new TypeError('An identity repository is required.');
  const hashing = new IdentityCrypto(webCrypto);
  const ref = async hash => typeof hash === 'string' && hash ? (await hashing.hash('transfer-credential', hash)) : null;
  const cas = async (owner, mutate) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const account = await repository.get(owner); if (!account || account.id !== owner) return { ok: false, status: 'missing' };
      const next = structuredClone(account), outcome = await mutate(next, account);
      if (outcome?.write !== true) return { ok: outcome?.ok === true, ...outcome?.status ? { status: outcome.status } : {}, ...outcome?.value };
      next.revision = account.revision + 1;
      if (await repository.compareAndSwap(owner, account.revision, next)) return { ok: true, ...outcome?.value };
    }
    return { ok: false, status: 'conflict' };
  };
  const bump = account => { const { epoch, changedAt } = securityState(account); account.security = { epoch: epoch + 1, changedAt: Math.max(changedAt, clock()) }; return account.security; };
  const audit = (account, type) => { account.audit = [...(account.audit || []).slice(-99), { id: webCrypto.randomUUID(), type, at: clock() }]; };
  return Object.freeze({
    async get(owner) {
      if (!isUUID(owner)) throw new TypeError('Invalid account identifier');
      const account = await repository.get(owner); if (!account || account.id !== owner) return null;
      const now = clock(), credential = recoveryCredential(account);
      return {
        status: account.status, kind: account.kind === 'organization' ? 'organization' : 'person', handle: account.handle ?? null,
        email: typeof account.verifiedEmail === 'string' && time(account.emailVerifiedAt) ? { address: account.verifiedEmail, verifiedAt: account.emailVerifiedAt } : null,
        removedEmails: Array.isArray(account.removedEmails) ? account.removedEmails.filter(entry => typeof entry?.address === 'string' && time(entry.removedAt)).map(entry => ({ address: entry.address, removedAt: entry.removedAt })) : [],
        recovery: credential ? { issuedAt: credential.issuedAt, version: credential.version, keyKid: credential.keyKid, ref: await ref(account.recoveryHash) } : null,
        security: securityState(account),
        sessions: (account.sessions ?? []).filter(s => typeof s?.id === 'string' && s.expiresAt > now).map(s => ({ id: s.id, createdAt: s.createdAt, credentialId: s.credentialId ?? null })),
        credentials: (account.credentials ?? []).filter(c => typeof c?.id === 'string').map(c => ({ id: c.id, createdAt: time(c.createdAt) ? c.createdAt : 0 })),
        moved: account.status === 'moved' && plain(account.moved) ? structuredClone(account.moved) : null,
      };
    },
    /** Checks a recovery token against the current credential without consuming it. Unknown and wrong fail alike. */
    async verifyRecovery(owner, token) {
      if (typeof token !== 'string' || !RECOVERY_TOKEN.test(token) || token.split('.')[0] !== owner) return null;
      const account = await repository.get(owner), proof = await hashing.hash('recovery', token);
      const credential = recoveryCredential(account);
      if (!account || !credential || !secureEqual(account.recoveryHash, proof)) return null;
      return { issuedAt: credential.issuedAt, version: credential.version, keyKid: credential.keyKid, ref: await ref(account.recoveryHash) };
    },
    /** Commit stage 1 (spec §6.3): status `moved`, every session and lineage revoked, recovery refused, email sign-in
     * off. Credentials stay until the purge so the owner can sign in read-only during the export window. */
    async markMoved(owner, { moved }) {
      return cas(owner, (account) => {
        if (account.status === 'moved' && account.moved?.statementDigest === moved.statementDigest) return { ok: true };
        if (account.status !== 'active') return { ok: false, status: account.status };
        const now = clock(); revokeAllLineage(account, now);
        Object.assign(account, { status: 'moved', moved: structuredClone(moved), sessions: [], challenges: [], emailChallenges: [], emailLoginEnabled: false, recoveryHash: null, pendingHash: null, pendingExpiresAt: null });
        for (const name of ['recoveryResumeHash', 'recoveryResumeBackupVersion', 'recoveryResumeKeyKid', 'recoveryIssuedAt', 'recoveryKeyKid', 'recoveryStaged', 'recoveryReissue']) delete account[name];
        audit(account, MOVED_AUDIT); return { ok: true, write: true };
      });
    },
    /** P17 requester-side resolution: revokes named sessions (and their descendants and lineage), removes named
     * passkeys, detaches named emails (kept for 30 days as removed channels) and bumps `security` once. */
    async removeDisputers(owner, { sessions = [], passkeys = [], emails = [], expectedEpoch }) {
      return cas(owner, (account) => {
        if (account.status !== 'active' || securityState(account).epoch !== expectedEpoch) return { ok: false, status: 'changed' };
        const now = clock(), removed = new Set(sessions);
        for (let changed = true; changed;) { changed = false; for (const s of account.sessions ?? []) if (s.parentSessionId && removed.has(s.parentSessionId) && !removed.has(s.id)) { removed.add(s.id); changed = true; } }
        account.sessions = (account.sessions ?? []).filter(s => !removed.has(s.id)); pruneLineage(account, now); revokeLineage(account, removed, now);
        account.credentials = (account.credentials ?? []).filter(c => !passkeys.includes(c.id));
        if (account.verifiedEmail && emails.includes(account.verifiedEmail)) {
          account.removedEmails = [...(Array.isArray(account.removedEmails) ? account.removedEmails : []).filter(entry => now - entry.removedAt < TIMING.removedChannels), { address: account.verifiedEmail, removedAt: now }].slice(-8);
          Object.assign(account, { verifiedEmail: null, emailVerifiedAt: null, emailLoginEnabled: false, emailChallenges: [] });
        }
        audit(account, 'transfer-disputers-removed'); return { ok: true, write: true, value: { security: { ...bump(account) } } };
      });
    },
    /** Elevated-proof abort and the owner's "reissue" choice: the current credential stops being current at once.
     * `reason: 'elevated-abort'` also arms the forced reissue (`recoveryReissue`, recovery-identity spec), keeping the
     * invalidated file's kid so the reissue rotates it away (P15). A staged reissue is discarded. */
    async invalidateRecovery(owner, { reason } = {}) {
      return cas(owner, (account) => {
        if (account.status !== 'active') return { ok: false, status: account.status };
        const arm = reason === 'elevated-abort';
        if (!account.recoveryHash && !arm && !account.recoveryStaged) return { ok: true };
        if(arm&&account.recoveryReissue?.reason!=='elevated-abort')raiseAuthorityEpoch(account,{reason:'elevated-abort'});
        if (arm) account.recoveryReissue = { reason, at: clock(), kid: typeof account.recoveryKeyKid === 'string' ? account.recoveryKeyKid : account.recoveryReissue?.kid ?? null };
        delete account.recoveryStaged;
        if (!account.recoveryHash) { audit(account, 'recovery-reissue-required'); return { ok: true, write: true }; }
        account.recoveryHash = null; delete account.recoveryIssuedAt; delete account.recoveryKeyKid;
        audit(account, 'recovery-file-invalidated'); bump(account); return { ok: true, write: true };
      });
    },
    /** Scheduler: at `movedUntil`, the new address and the move proof are deleted (design §6.5 item 4). */
    async endMoved(owner) {
      return cas(owner, (account) => {
        if (account.status !== 'moved' || !plain(account.moved)) return { ok: true, value: { ended: true } };
        const window = movedWindow(account.moved, clock());
        if (window.live || window.proof) return { ok: true, value: { ended: false, nextAt: window.nextAt } };
        // Purged (credentials gone) identities become exactly a deleted one; an unpurged one keeps `moved` without a target.
        const purged = !account.passwordHash && !(account.credentials ?? []).length && account.movedPurgedAt !== undefined;
        account.moved = { v: 1, ended: true, committedAt: account.moved.committedAt, exportUntil: account.moved.exportUntil };
        if (purged) { account.status = 'deleted'; delete account.moved; }
        return { ok: true, write: true, value: { ended: true } };
      });
    },
  });
}

// ---- attestor -------------------------------------------------------------------------------------------------

/** The attestation signer (PORT-4, P16): `IDENTITY_ATTESTATION_KEYS` (a continuity-chained key set) or the legacy
 * single `{kid, jwk}` of `IDENTITY_ATTESTATION_KEY`, read as a one-key root set. Null when unconfigured or invalid;
 * see packages/identity/attestation-keys.mjs. Kept under this name for PORT-2 callers. */
export function attestorFromJwk(config, { crypto: webCrypto = globalThis.crypto } = {}) {
  if (!config) return null;
  return attestorFromConfig(config, { crypto: webCrypto });
}

// ---- notices --------------------------------------------------------------------------------------------------

export const TRANSFER_DISPUTE_PATH = '/account/transfer-out/dispute';
const NOTICE_KINDS = ['pending', 'restarted', 'cancelled', 'committed'];
/** Plain-language notice. Caller-provided URLs are never authority; the dispute token travels in a fragment. */
export function transferNoticeTemplate(notice, { origin }) {
  if (!plain(notice) || !isUUID(notice.owner) || !NOTICE_KINDS.includes(notice.kind) || !httpsOrigin(notice.destination) && !/^http:\/\/localhost(:\d+)?$/.test(notice.destination ?? '')) throw new TypeError('Invalid transfer notice.');
  if (notice.disputeToken !== undefined && (typeof notice.disputeToken !== 'string' || !TOKEN.test(notice.disputeToken))) throw new TypeError('Invalid transfer dispute link.');
  const host = new URL(notice.destination).host, link = notice.disputeToken ? `${origin}${TRANSFER_DISPUTE_PATH}#owner=${notice.owner}&token=${notice.disputeToken}` : null;
  const subject = notice.kind === 'committed' ? 'Your identity moved' : notice.kind === 'cancelled' ? 'Identity move cancelled' : 'Your identity is being moved';
  const when = time(notice.notBefore) ? `${new Date(notice.notBefore).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null;
  const body = notice.kind === 'committed' ? `Your identity moved to ${host}. 3sln.me no longer speaks for you; apps connected here lost access.`
    : notice.kind === 'cancelled' ? `The move of your identity to ${host} was cancelled. Nothing moved.`
    : `Someone asked to move your identity to ${host}. It moves no earlier than ${when ?? `${notice.delayHours} hours after this notice`}, and 3sln.me will then stop speaking for you.`;
  const guidance = link ? 'Not you? Open this link to freeze or cancel the move. It does not sign you in.' : notice.kind === 'committed' ? 'For 30 days you can still sign in here to download your data.' : '';
  return { subject, text: [body, guidance, ...link ? [link] : []].filter(Boolean).join('\n\n'), push: { type: 'bindle-transfer-notice', owner: notice.owner, kind: notice.kind, title: subject, body: `${body} ${guidance}`.trim(), ...link ? { path: `${TRANSFER_DISPUTE_PATH}#owner=${notice.owner}&token=${notice.disputeToken}` } : {} } };
}
/** `notices.deliver` over the existing mail (`sendTransferNotice`) and Web Push transports. No retry or token
 * persistence here; the service owns both. A transport that lacks the method leaves that channel unaccepted. */
export function createTransferNotices({ origin, mail = null, push = null }) {
  if (typeof origin !== 'string' || new URL(origin).origin !== origin) throw new TypeError('Invalid transfer notice origin.');
  return Object.freeze({
    async deliver(notice) {
      const template = transferNoticeTemplate(notice, { origin }), channel = notice.channel;
      try {
        if (channel?.email && typeof mail?.sendTransferNotice === 'function') { const result = await mail.sendTransferNotice({ email: channel.email, notice: { ...notice, channel: undefined } }); return { accepted: typeof result?.messageId === 'string' && Boolean(result.messageId) }; }
        if (channel?.push && typeof push?.send === 'function') { const result = await push.send(channel.push, template.push); return { accepted: result?.accepted === true }; }
      } catch { return { accepted: false }; }
      return { accepted: false };
    },
  });
}

// ---- scheduler backstop ---------------------------------------------------------------------------------------

/** `transfer-due/<at>/<kind>/<owner>` rows over any key/value metadata store (the lifecycle scheduler object on the
 * Worker, the identity directory on Node). `tick` rows step the account; `moved-end` rows end a moved record. */
export function transferDueIndex(metadata) {
  const name = (owner, at, kind) => { if (!isUUID(owner) || !time(at) || !['tick', 'moved-end'].includes(kind)) throw new TypeError('Invalid transfer index entry'); return `transfer-due/${String(at).padStart(16, '0')}/${kind}/${owner}`; };
  return Object.freeze({
    put: (owner, at, kind = 'tick') => metadata.put(name(owner, at, kind), { owner, at, kind }),
    delete: (owner, at, kind = 'tick') => metadata.delete(name(owner, at, kind)),
    async due({ now = Date.now(), limit = 64 } = {}) { const rows = await metadata.list({ prefix: 'transfer-due/', limit }); return [...rows.values()].filter(row => isUUID(row?.owner) && time(row.at) && row.at <= now); },
  });
}
/** One bounded sweep: `moved-end` rows end the moved record through the identity port (no account object needed, so
 * it works after the purge); `tick` rows step the account. A row is removed once its work reports done. */
export async function sweepTransferDue({ index, identity, accounts, now = Date.now(), limit = 64 }) {
  let done = 0, failed = 0;
  for (const row of await index.due({ now, limit })) {
    try {
      if (row.kind === 'moved-end') { const result = await identity.endMoved(row.owner); if (result?.ok && result.ended !== false) { await index.delete(row.owner, row.at, row.kind); done++; } else if (result?.ok && time(result.nextAt)) { await index.put(row.owner, result.nextAt, row.kind); await index.delete(row.owner, row.at, row.kind); done++; } else failed++; }
      else { const result = await accounts.get(row.owner).invoke({ method: 'transferOutTick', args: [row.owner, { source: 'sweep' }] }); if (result?.$fault && result.$fault.code !== 'account_deleted') failed++; else { await index.delete(row.owner, row.at, row.kind); done++; } }
    } catch { failed++; }
  }
  return { done, failed };
}
export { SuccessionError };
