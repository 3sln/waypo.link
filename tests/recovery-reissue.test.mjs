// Active-account recovery-file reissue (docs/spec/recovery-identity.md "Active-account reissue", provisional; identity
// portability P14, P15, P17). Engine-level: the real IdentityService over the durable Node runtime's identity
// repository and account objects (single writer, real key registry, real transfer-out service), with recording notice
// ports. Seeded chaos interleavings are in tests/recovery-reissue-chaos.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reissueFixture, DAY, MINUTE, TRANSFER_KEY, LOCK_KEY, REQUEST_KEY } from './helpers/recovery-reissue.mjs';
import { recoveryCredential, RECOVERY_CREDENTIAL_AGE_MS, RECOVERY_REISSUE_TTL_MS, RECOVERY_REISSUE_WINDOW_MS } from '../packages/identity/service.mjs';
import { transferIdentityPort } from '../packages/identity/transfer-out.mjs';
import { transferInRecoveryPort, RECOVERY_REISSUE_OPERATIONS } from '../packages/identity/recovery-reissue.mjs';
import { operations } from '../packages/app/engine.mjs';
import { KEY_HISTORY_LIMIT } from '../packages/identity/keys.mjs';

const audits = record => record.audit.map(entry => entry.type);

test('operations register under unique wire names and are terms-exempt', () => {
  assert.deepEqual(Object.keys(operations(...RECOVERY_REISSUE_OPERATIONS)).sort(), ['recovery.reissue-cancel', 'recovery.reissue-commit', 'recovery.reissue-prepare']);
  for (const Operation of RECOVERY_REISSUE_OPERATIONS) assert.equal(Operation.termsGate, 'exempt');
  assert.equal(RECOVERY_CREDENTIAL_AGE_MS, 7 * DAY); assert.equal(RECOVERY_REISSUE_TTL_MS, 30 * MINUTE); assert.equal(RECOVERY_REISSUE_WINDOW_MS, 7 * DAY);
});

test('aged owner: begin stages, rotates and notifies; confirm commits into the 7-day window (new file not yet usable, old file cancel-only), resets P14 age and notifies every channel with a cancel link', async t => {
  const f = await reissueFixture(t), { id, c } = f;
  await f.age(); await f.stepUp('password');
  const before = await f.identity(), k0 = f.file.backup.keychain.signing.kid;
  const begun = await f.begin();
  assert.equal(begun.transferPending, false); assert.equal(begun.forced, null);
  const staged = f.parse(begun), k1 = staged.backup.keychain.signing.kid;
  assert.notEqual(k1, k0, 'P15: issuance rotates the signing key first');
  assert.equal(await f.keyState(k0), 'retired'); assert.equal(await f.keyState(k1), 'active');
  assert.equal(await f.continuity(k0, k1), true, 'the old key signs its successor');
  let record = await f.identity();
  assert.equal(record.recoveryHash, before.recoveryHash, 'the current credential is unchanged until confirmation');
  assert.equal(record.recoveryStaged.kid, k1); assert.equal(record.security.epoch, before.security.epoch, 'staging is not a security change');
  assert.equal(await c.recoveryKeysMatch(id, f.file.backup.keychain), true, 'the current file (now a bound retired key) still restores');
  // Wargame 2026-10-23 #1(c): every channel hears about the reissue when it begins.
  assert.deepEqual(f.mail, [{ email: 'owner@reissue.example', type: 'recovery-reissue-started', owner: id }]); assert.deepEqual(f.push, [{ owner: id, event: 'recovery-reissue-started' }]);
  const done = await f.confirm(staged);
  assert.equal(done.reissued, true); assert.equal(done.transferCancelled, false); assert.equal(done.usableAt, f.now() + 7 * DAY);
  assert.deepEqual(done.notified, { email: true, push: true });
  const { cancelToken, ...notice } = f.mail[1];
  assert.deepEqual(notice, { email: 'owner@reissue.example', type: 'recovery-reissued', owner: id, usableAt: f.now() + 7 * DAY });
  assert.match(cancelToken, new RegExp(`^${id}\\.[A-Za-z0-9_-]{43}$`), 'the email verified before the reissue gets a cancel link');
  assert.deepEqual(f.push[1], { owner: id, event: 'recovery-reissued' });
  record = await f.identity();
  assert.deepEqual(recoveryCredential(record), { issuedAt: f.now(), version: 2, keyKid: k1 });
  assert.equal(record.recoveryStaged, undefined); assert.equal(record.security.epoch, before.security.epoch + 1);
  assert.ok(audits(record).includes('recovery-file-reissued'));
  // P14: the new file is younger than 7 days; the old one is not current at all.
  const port = transferIdentityPort(f.repository, { clock: f.now });
  assert.equal((await port.verifyRecovery(id, staged.recoveryToken)).issuedAt, f.now());
  assert.equal(await port.verifyRecovery(id, f.file.recoveryToken), null);
  assert.equal(done.recovery.transferEligibleAt, f.now() + 7 * DAY);
  // Wargame #1(b), (d): during the window neither file starts a recovery; the old one may only cancel.
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_pending' });
  await assert.rejects(f.recover(staged), { code: 'recovery_not_ready' });
  assert.equal((await f.owner()).recovery.pendingReissue.usableAt, f.now() + 7 * DAY);
  f.advance(7 * DAY - 1); await assert.rejects(f.recover(staged), { code: 'recovery_not_ready' });
  // After the window the old file never recovers again; the new one does.
  f.advance(1); await assert.rejects(f.recover(f.file), { code: 'unauthorized' });
  const recovered = await f.recover(staged); assert.equal(recovered.resumed, false);
  assert.equal((await f.identity()).recoveryPrevious, undefined);
});

test('authority: a fresh step-up with a credential enrolled at least 7 days earlier, acknowledgement, and the recovery feature', async t => {
  const f = await reissueFixture(t);
  await assert.rejects(f.begin(), { code: 'reauthentication_required' }, 'no step-up');
  await f.stepUp('password'); f.advance(5 * MINUTE);
  await assert.rejects(f.begin(), { code: 'reauthentication_required' }, 'a step-up older than 5 minutes');
  await f.stepUp('password');
  await assert.rejects(f.begin(), { code: 'credential_too_new' }, 'only a new credential exists');
  await f.patch(a => ({ ...a, credentials: [{ id: 'pk-old', createdAt: f.now() - 8 * DAY, publicKey: 'x', counter: 0 }] }));
  await assert.rejects(f.begin(), { code: 'reauthentication_required' }, 'a newer credential was used while an aged one exists: confirm with that one');
  // Wargame #1(a): with any passkey enrolled, even an aged password never authorizes a reissue.
  await f.patch(a => ({ ...a, passwordSetAt: f.now() - 30 * DAY })); await f.stepUp('password');
  await assert.rejects(f.begin(), { code: 'reauthentication_required', message: /passkey/ });
  await f.patch(a => ({ ...a, credentials: [], passwordSetAt: f.now() - RECOVERY_CREDENTIAL_AGE_MS })); await f.stepUp('password');
  await assert.rejects(f.begin({ acknowledged: false }), { code: 'confirmation_required' });
  await assert.rejects(f.begin({ acknowledged: true, extra: 1 }), { code: 'invalid_request' });
  const unconfigured = f.service.identityBackup; f.service.identityBackup = { issue: unconfigured.issue };
  await assert.rejects(f.begin(), { code: 'recovery_unavailable' }); f.service.identityBackup = unconfigured;
  const legacy = await f.identity(); assert.equal(legacy.passwordSetAt, f.now() - RECOVERY_CREDENTIAL_AGE_MS);
  assert.ok(await f.begin(), 'exactly 7 days old qualifies');
  // The step-up records the credential that confirmed it.
  assert.deepEqual((await f.identity()).sessions.find(s => s.stepUpAt).stepUpCredential, { kind: 'password' });
});

test('confirmation: bound to the session, the staged token, 30 minutes and the credential it replaces', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  const staged = f.parse(await f.begin());
  await assert.rejects(f.confirm({ ...staged, recoveryToken: `${f.id}.${'w'.repeat(43)}` }), { code: 'recovery_reissue_expired' }, 'wrong token');
  await assert.rejects(f.confirm(staged, { downloadConfirmed: false }), { code: 'recovery_confirmation_required' });
  const other = await f.secondSession();
  await assert.rejects(f.confirm(staged, {}, other), { code: 'recovery_reissue_expired' }, 'another session never confirms');
  f.advance(RECOVERY_REISSUE_TTL_MS);
  await assert.rejects(f.confirm(staged), { code: 'recovery_reissue_expired' }, 'expired');
  // A newer begin replaces the staged file and rotates its key away; the replaced staged file never becomes current.
  await f.stepUp('password'); const first = f.parse(await f.begin()); await f.stepUp('password'); const second = f.parse(await f.begin());
  assert.notEqual(second.backup.keychain.signing.kid, first.backup.keychain.signing.kid);
  assert.equal(await f.keyState(first.backup.keychain.signing.kid), 'retired');
  await assert.rejects(f.confirm(first), { code: 'recovery_reissue_expired' });
  await f.confirm(second);
  await assert.rejects(f.recover(first), { code: 'unauthorized' });
  // One window at a time: nothing new can be staged until it ends (or is cancelled).
  await f.stepUp('password'); await assert.rejects(f.begin(), { code: 'recovery_reissue_pending' });
  // A staged file whose base credential changed (another reissue committed from another session) is refused.
  f.advance(RECOVERY_REISSUE_WINDOW_MS); await f.age(); const s1 = await f.secondSession(), s2 = await f.secondSession();
  await f.stepUp('password', s1); const third = f.parse(await f.begin(undefined, s1));
  await f.stepUp('password', s2); await f.confirm(f.parse(await f.begin(undefined, s2)), {}, s2);
  await assert.rejects(f.confirm(third, {}, s1), { code: 'recovery_reissue_expired' }, 'the other session replaced the staged record');
});

test('an ordinary key rotation between begin and confirm refuses the stale staged file; restarting works', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  const staged = f.parse(await f.begin()), k1 = staged.backup.keychain.signing.kid;
  await f.c.rotateIdentityKey(f.id, { purpose: 'signing', expectedKid: k1 });
  await assert.rejects(f.confirm(staged), { code: 'recovery_reissue_expired' });
  const record = await f.identity(); assert.equal(record.recoveryHash, (await f.identityBefore()).recoveryHash, 'nothing was committed');
  await f.stepUp('password'); const fresh = f.parse(await f.begin()); await f.confirm(fresh);
  f.advance(RECOVERY_REISSUE_WINDOW_MS); assert.ok(await f.recover(fresh));
});

test('a reissue that must rotate but cannot (a full history of referenced keys) refuses with rotation_unavailable and stages nothing', async t => {
  // Review 2026-10-23 item 3: never issue a replacement file that holds the same signing key.
  const f = await reissueFixture(t), { id, c } = f; await f.age();
  const link = { name: 'Friends', mimeTypes: ['text/plain'], expiresAt: Date.now() + 365 * DAY, maxMessages: 50, maxBytes: 65536, maxMessageBytes: 4096 };
  // Each cycle: a live contact link references the file's key, then a reissue rotates away from it; nothing is prunable.
  // Each committed reissue opens a 7-day window, so every cycle waits it out with a new session.
  let ctx = f.ctx;
  for (let i = 1; i < KEY_HISTORY_LIMIT; i++) { await c.createContactLink(id, f.handle, { ...link, name: `L${i}` }); await f.age(); await f.stepUp('password', ctx); await f.confirm(f.parse(await f.begin(undefined, ctx)), {}, ctx); f.advance(RECOVERY_REISSUE_WINDOW_MS); ctx = await f.secondSession(); }
  await c.createContactLink(id, f.handle, { ...link, name: 'last' });
  assert.equal((await c.identityKeyHistory(id, { purpose: 'signing' })).length, KEY_HISTORY_LIMIT);
  await f.age(); await f.stepUp('password', ctx);
  const before = await f.identity();
  await assert.rejects(f.begin(undefined, ctx), { code: 'rotation_unavailable', status: 409 });
  const after = await f.identity();
  assert.equal(after.recoveryStaged ?? null, before.recoveryStaged ?? null, 'nothing staged'); assert.equal(after.recoveryHash, before.recoveryHash, 'the current file keeps working');
  assert.equal((await c.identityKeyHistory(id, { purpose: 'signing' })).length, KEY_HISTORY_LIMIT, 'no referenced key was pruned');
});

test('deletion: refused while scheduled or executing, including one scheduled between begin and confirm; nothing changes', async t => {
  for (const state of ['scheduled', 'executing']) {
    const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
    await f.c.metadata.put(REQUEST_KEY, { state });
    const kid = (await f.c.signingKey(f.id)).kid;
    await assert.rejects(f.begin(), { code: 'deletion_scheduled' });
    assert.equal((await f.c.signingKey(f.id)).kid, kid, 'refused before any rotation');
    await f.c.metadata.delete(REQUEST_KEY);
    const staged = f.parse(await f.begin());
    await f.c.metadata.put(REQUEST_KEY, { state });
    await assert.rejects(f.confirm(staged), { code: 'deletion_scheduled' });
    assert.equal((await f.identity()).recoveryHash, (await f.identityBefore()).recoveryHash);
  }
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  await f.c.metadata.put('lifecycle/tombstone-v1', { at: 1 });
  await assert.rejects(f.begin(), { code: 'account_deleted' });
});

test('transfer-out: begin reports a pending move; confirm cancels it (no P14 dodge); contested, locked and committed moves refuse', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  await f.seedTransfer({ state: 'pending' });
  const staged = f.parse(await f.begin()); assert.equal(staged.transferPending, true);
  const done = await f.confirm(staged); assert.equal(done.transferCancelled, true);
  const record = await f.c.metadata.get(TRANSFER_KEY); assert.equal(record.state, 'cancelled'); assert.equal(record.reason, 'recovery-reissued');
  // The new credential cannot start a move for 7 days (credential age), and the security bump trips the look-back.
  assert.ok(f.now() - (await f.identity()).security.changedAt < 7 * DAY);
  for (const [seed, code] of [[{ state: 'held' }, null], [{ state: 'contested' }, 'transfer_contested']]) {
    const g = await reissueFixture(t); await g.age(); await g.stepUp('password'); await g.seedTransfer(seed);
    if (code) { await assert.rejects(g.begin(), { code }); continue; }
    const s = g.parse(await g.begin()); assert.equal((await g.confirm(s)).transferCancelled, true); assert.equal((await g.c.metadata.get(TRANSFER_KEY)).state, 'cancelled');
  }
  const locked = await reissueFixture(t); await locked.age(); await locked.stepUp('password');
  await locked.c.metadata.put(LOCK_KEY, { contested: { since: locked.now(), until: null, reason: 'test' } });
  await assert.rejects(locked.begin(), { code: 'transfer_locked' });
  const moved = await reissueFixture(t); await moved.age(); await moved.stepUp('password');
  await moved.seedTransfer({ state: 'committed' });
  await assert.rejects(moved.begin(), { code: 'identity_moved' });
});

test('forced path after an elevated abort: no aged credential needed; the invalidated file\'s key is rotated away; another credential within 30 days is contested', async t => {
  const f = await reissueFixture(t), port = transferIdentityPort(f.repository, { clock: f.now });
  const k0 = f.file.backup.keychain.signing.kid;
  assert.equal((await port.invalidateRecovery(f.id, { reason: 'elevated-abort' })).ok, true);
  let record = await f.identity();
  assert.equal(record.recoveryHash, null); assert.deepEqual(record.recoveryReissue, { reason: 'elevated-abort', at: f.now(), kid: k0 });
  assert.equal((await f.owner()).recovery.reissueRequired, 'elevated-abort');
  await f.c.metadata.put(LOCK_KEY, { elevatedAbort: { at: f.now(), credentialId: null, sessionId: f.sessionId } });
  // Another session (another credential) is contested and refused (P17).
  const other = await f.secondSession(); await f.stepUp('password', other);
  await assert.rejects(f.begin(undefined, other), { code: 'transfer_contested' });
  assert.ok((await f.c.metadata.get(LOCK_KEY)).contested, 'the account goes to support');
  await f.c.metadata.put(LOCK_KEY, { elevatedAbort: { at: f.now(), credentialId: null, sessionId: f.sessionId } });
  // Review M1: the marker never waives the age for a credential enrolled after it was armed.
  const armedAt = f.now(); f.advance(MINUTE); await f.patch(a => ({ ...a, passwordSetAt: f.now() }));
  await f.stepUp('password'); await assert.rejects(f.begin(), { code: 'credential_too_new' });
  await f.patch(a => ({ ...a, passwordSetAt: armedAt }));
  await f.stepUp('password');
  const staged = f.parse(await f.begin()); assert.equal(staged.forced, 'elevated-abort');
  assert.notEqual(staged.backup.keychain.signing.kid, k0); assert.equal(await f.keyState(k0), 'retired');
  // Review L5: the credential that authorized phase 1 must still exist at confirmation.
  const password = (await f.identity()).passwordHash; await f.patch(a => ({ ...a, passwordHash: null }));
  await assert.rejects(f.confirm(staged), { code: 'recovery_reissue_expired' });
  await f.patch(a => ({ ...a, passwordHash: password }));
  await f.confirm(staged);
  record = await f.identity(); assert.equal(record.recoveryReissue, undefined); assert.equal(recoveryCredential(record).keyKid, staged.backup.keychain.signing.kid);
  await assert.rejects(f.recover(f.file), { code: 'unauthorized' });
  // The window is open (the invalidated file has nothing to restore); after it the marker is spent and the next
  // reissue needs an aged credential again.
  await f.stepUp('password'); await assert.rejects(f.begin(), { code: 'recovery_reissue_pending' });
  f.advance(RECOVERY_REISSUE_WINDOW_MS); await f.patch(a => ({ ...a, passwordSetAt: f.now() - DAY }));
  const later = await f.secondSession(); await f.stepUp('password', later); await assert.rejects(f.begin(undefined, later), { code: 'credential_too_new' });
});

test('forced path after PORT-4 activation: the recovery port arms the reissue; the first file adopts the activation key', async t => {
  const f = await reissueFixture(t);
  await f.patch(a => { const next = { ...a, recoveryHash: null }; delete next.recoveryIssuedAt; delete next.recoveryKeyKid; return next; });
  const port = transferInRecoveryPort(f.repository, { clock: f.now });
  assert.deepEqual(await port.issue(f.id), { ok: false, armed: true });
  assert.deepEqual(await port.issue(f.id), { ok: false, armed: true }, 'idempotent');
  assert.deepEqual((await f.identity()).recoveryReissue, { reason: 'transfer-in', at: f.now(), kid: null });
  const current = (await f.c.signingKey(f.id)).kid;
  await f.stepUp('password'); const staged = f.parse(await f.begin());
  assert.equal(staged.backup.keychain.signing.kid, current, 'activation already rotated (P11); the first file adopts the key');
  await f.confirm(staged); assert.equal((await f.identity()).recoveryReissue, undefined);
  await assert.rejects(port.issue('00000000-0000-4000-8000-000000000000'), { code: 'identity_unavailable' });
});

test('a recovery started with the current file supersedes a staged reissue; a recovering account cannot confirm', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  const staged = f.parse(await f.begin());
  await f.recover(f.file);
  const record = await f.identity(); assert.equal(record.status, 'recovering'); assert.equal(record.recoveryStaged, undefined);
  await assert.rejects(f.confirm(staged), { code: 'unauthorized' }, 'the session ended with the recovery');
});

test('the owner projection reports the recovery file status without secrets', async t => {
  const f = await reissueFixture(t), view = (await f.owner()).recovery;
  assert.deepEqual(Object.keys(view).sort(), ['issuedAt', 'pendingReissue', 'reissueAvailable', 'reissueRequired', 'transferEligibleAt', 'version']);
  assert.equal(view.pendingReissue, null);
  assert.equal(view.version, 2); assert.equal(view.reissueRequired, null); assert.equal(view.reissueAvailable, true);
  assert.equal(JSON.stringify(view).includes((await f.identity()).recoveryHash), false);
});
