// Recovery file v3 (docs/3sln/accounts/recovery-file.md; recovery and transfer spike §4, option C, owner approval
// 2026-10-28). Engine-level: the real IdentityService over the durable Node runtime (tests/helpers/recovery-reissue.mjs)
// plus the shared envelope module. Covers the opaque payload round trip, credential checks by hash only, rejection of
// envelope v1 (payloads v1 and v2), the two-phase reissue that never cancels the old file before acknowledgement, the
// 7-day gap, the annual reminder schedule, the file-id check-up and the absence of private keys anywhere in a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reissueFixture, DAY, MINUTE, ORIGIN } from './helpers/recovery-reissue.mjs';
import { encryptRecoveryFile, decryptRecoveryFile, inspectRecoveryFile, validateRecoveryPayload, createRecoveryPayload,
  recoveryFileDigest, RECOVERY_VERSION, RECOVERY_PAYLOAD_VERSION, RECOVERY_FILE_ID } from '../packages/recovery/index.mjs';
import { recoveryReminder, RECOVERY_REMINDER_PERIOD_MS, RECOVERY_REMINDER_LEAD_MS, RECOVERY_REMINDER_REPEAT_MS } from '../packages/identity/recovery-reminder.mjs';
import { recoveryCredential, RECOVERY_REISSUE_TTL_MS, RECOVERY_REISSUE_WINDOW_MS } from '../packages/identity/service.mjs';
import { KEY_PURPOSES } from '../packages/identity/keys.mjs';
import { forEachSeed } from './helpers/chaos.mjs';

// Envelope binding is a property of the AEAD construction; a fast keyed KDF substitute keeps these tests quick (the
// archived Argon2id vector is in tests/recovery-file.test.mjs).
const fast = { crypto: globalThis.crypto, deriveKey: async ({ password, salt, hashLength }) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...password, ...salt]))).slice(0, hashLength) };
const QUESTIONS = [{ id: 'phrase', type: 'passphrase', prompt: 'My private recovery passphrase', hint: '' }], ANSWERS = ['correct horse battery staple'];
const PRIVATE = /"d"\s*:|privateJWK|keychain|"proof"|BEGIN|"kty"/;
const encrypt = payload => encryptRecoveryFile(payload, QUESTIONS, ANSWERS, fast);

test('payload v3 is exactly {version, issuer, entity, recoveryToken, fileId, issuedAt}; envelope v2 carries the public fileId bound into the AAD', async t => {
  const f = await reissueFixture(t);
  const payload = validateRecoveryPayload(f.file.payload);
  assert.equal(payload.version, RECOVERY_PAYLOAD_VERSION); assert.equal(payload.issuer, ORIGIN); assert.equal(payload.entity, f.id);
  assert.equal(payload.recoveryToken, f.file.recoveryToken); assert.match(payload.fileId, RECOVERY_FILE_ID); assert.equal(payload.fileId, f.file.fileId);
  assert.equal(payload.issuedAt, (await f.identity()).recoveryIssuedAt);
  assert.equal(PRIVATE.test(JSON.stringify(f.file.payload)), false, 'no private key, keychain or provider proof in the payload');
  const file = await encrypt(f.file.payload);
  assert.equal(file.version, RECOVERY_VERSION); assert.equal(file.fileId, payload.fileId);
  assert.deepEqual(inspectRecoveryFile(JSON.stringify(file)).fileId, payload.fileId, 'the id is readable without the answers');
  assert.deepEqual(await decryptRecoveryFile(JSON.stringify(file), ANSWERS, fast), payload);
  const text = JSON.stringify(file);
  for (const secret of [payload.recoveryToken, payload.entity, payload.issuer]) assert.equal(text.includes(secret), false, 'the credential, UUID and issuer stay encrypted');
  // The header id is authenticated: a swapped id fails like any tampering, after the KDF, with the generic outcome.
  const swapped = { ...file, fileId: createRecoveryPayload({ ...payload, fileId: 'AAAAAAAAAAAAAAAAAAAAAA' }).fileId };
  await assert.rejects(decryptRecoveryFile(swapped, ANSWERS, fast), { code: 'recovery_file_authentication_failed' });
  await assert.rejects(decryptRecoveryFile(file, ['wrong'], fast), { code: 'recovery_file_authentication_failed' });
});

test('payload validation is strict: unknown members, foreign credentials, non-origin issuers and bad ids are refused', () => {
  const entity = '0f8e6a52-3c1b-4d7e-9a2f-5b6c7d8e9f01', good = { version: 3, issuer: 'https://identity.example', entity, recoveryToken: `${entity}.${'A'.repeat(43)}`, fileId: 'ICEiIyQlJicoKSorLC0uLw', issuedAt: 1 };
  assert.deepEqual(validateRecoveryPayload(good), good);
  const bad = [
    { ...good, version: 2 }, { ...good, version: 1 }, { ...good, keychain: {} }, { ...good, proof: {} }, { ...good, handle: 'alice' }, { ...good, warning: 'x' },
    { ...good, issuer: 'https://identity.example/path' }, { ...good, issuer: 'http://identity.example' }, { ...good, issuer: 'javascript:alert(1)' },
    { ...good, entity: 'not-a-uuid' }, { ...good, recoveryToken: `00000000-0000-4000-8000-000000000000.${'A'.repeat(43)}` }, { ...good, recoveryToken: `${entity}.short` },
    { ...good, fileId: 'ICEiIyQlJicoKSorLC0uLx' }, { ...good, fileId: 'short' }, { ...good, issuedAt: -1 }, { ...good, issuedAt: 1.5 },
  ];
  for (const value of bad) assert.throws(() => validateRecoveryPayload(value), { code: 'recovery_file_invalid' }, JSON.stringify(value));
  assert.deepEqual(validateRecoveryPayload({ ...good, issuer: 'http://localhost:8788' }).issuer, 'http://localhost:8788', 'loopback http is allowed for local development');
});

test('envelope v1 files (payloads v1 and v2) are refused before any key derivation, with a plain "older format" message', async () => {
  let derives = 0; const forbidden = { crypto: globalThis.crypto, deriveKey() { derives++; throw new Error('must not derive'); } };
  const v1 = { format: '3sln-recovery', version: 1, normalization: '3sln-answers-v1', questions: QUESTIONS, kdf: { name: 'argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, keyBytes: 32, salt: 'AAECAwQFBgcICQoLDA0ODw' }, cipher: { name: 'AES-256-GCM', iv: 'EBESExQVFhcYGRob' }, ciphertext: 'A'.repeat(40) };
  assert.throws(() => inspectRecoveryFile(v1), error => error.code === 'recovery_file_invalid' && error.legacy === true && /older format/.test(error.message));
  await assert.rejects(decryptRecoveryFile(JSON.stringify(v1), ANSWERS, forbidden), { code: 'recovery_file_invalid' });
  assert.equal(derives, 0);
  // A v2 (keychain) payload cannot be encrypted into a v3 envelope either.
  await assert.rejects(encryptRecoveryFile({ version: 2, issuer: ORIGIN, entity: '0f8e6a52-3c1b-4d7e-9a2f-5b6c7d8e9f01', recoveryToken: 'x', warning: 'w', keychain: {}, proof: {} }, QUESTIONS, ANSWERS, fast), { code: 'recovery_file_invalid' });
});

test('the provider checks the credential by hash only: no token, key or keychain is stored or consulted; issuance never touches keys', async t => {
  const f = await reissueFixture(t), record = await f.identity();
  assert.equal(JSON.stringify(record).includes(f.file.recoveryToken), false, 'only the hash is stored');
  assert.equal(record.recoveryBackupVersion, 3); assert.equal(record.recoveryFileId, f.file.fileId); assert.equal(record.recoveryKeyKid, undefined);
  assert.deepEqual(KEY_PURPOSES, ['signing'], 'the identity encryption key was removed');
  for (const row of ['encryption-key', `identity-key-recovery/${f.id}/`]) assert.equal(await f.c.metadata.get(row), undefined, row);
  assert.deepEqual((await f.c.metadata.list({ prefix: `identity-encryption-key/${f.id}/` })).size ?? [...await f.c.metadata.list({ prefix: `identity-encryption-key/${f.id}/` })].length, 0);
  // A forged or altered credential is refused; extra members (a v2 `identityBackup`) are ignored, never required.
  await assert.rejects(f.service.recover({ recoveryToken: `${f.id}.${'B'.repeat(43)}`, turnstileToken: 'ok' }, { origin: ORIGIN, remoteIP: '127.0.0.1' }), { code: 'unauthorized' });
  const started = await f.service.recover({ recoveryToken: f.file.recoveryToken, identityBackup: { forged: true }, turnstileToken: 'ok' }, { origin: ORIGIN, remoteIP: '127.0.0.1' });
  assert.equal(started.resumed, false); assert.equal((await f.identity()).recoveryResumeBackupVersion, 3);
  // The same token resumes the transaction it started.
  assert.equal((await f.recover(f.file)).resumed, true);
});

test('a stored v1/v2 credential recovers nothing, cannot cancel, and the console asks for a new file (legacy-format)', async t => {
  for (const version of [undefined, 2]) {
    const f = await reissueFixture(t);
    await f.patch(a => { const next = { ...a }; delete next.recoveryFileId; if (version) next.recoveryBackupVersion = version; else delete next.recoveryBackupVersion; next.recoveryKeyKid = 'legacy-kid'; return next; });
    assert.equal(recoveryCredential(await f.identity()), null);
    await assert.rejects(f.recover(f.file), { code: 'unauthorized' });
    const view = (await f.owner()).recovery;
    assert.equal(view.reissueRequired, 'legacy-format'); assert.equal(view.fileId, null); assert.equal(view.reminder, null);
    // The ordinary reissue replaces it (age rule applies); the legacy previous credential can never cancel.
    await f.age(); await f.stepUp(); const staged = f.parse(await f.begin()); await f.confirm(staged);
    const record = await f.identity(); assert.equal(record.recoveryPrevious.version, 'legacy'); assert.equal(record.recoveryKeyKid, undefined);
    assert.equal((await f.owner()).recovery.pendingReissue.previousFileCanCancel, false);
    await assert.rejects(f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken }, { origin: ORIGIN, remoteIP: '127.0.0.1' }), { code: 'recovery_reissue_not_pending' });
    f.advance(RECOVERY_REISSUE_WINDOW_MS); assert.ok(await f.recover(staged));
  }
});

test('reissue never cancels the old file before acknowledgement: staged, abandoned or expired, the old file keeps full authority', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp();
  const staged = f.parse(await f.begin()), base = { origin: ORIGIN, remoteIP: '127.0.0.1' };
  // Staged but not confirmed: the old file is current (it can authorize a transfer check and recover); the new one is not.
  assert.equal(recoveryCredential(await f.identity()).fileId, f.file.fileId);
  await assert.rejects(f.recover(staged), { code: 'unauthorized' }, 'an unconfirmed file is no credential');
  f.advance(RECOVERY_REISSUE_TTL_MS + MINUTE);
  await assert.rejects(f.confirm(staged), { code: 'recovery_reissue_expired' });
  assert.equal(recoveryCredential(await f.identity()).fileId, f.file.fileId, 'expiry of the staging leaves the old file current');
  // Confirmation is the only event that makes a new file current: it needs the staged token AND its file id.
  await f.stepUp(); const second = f.parse(await f.begin());
  await assert.rejects(f.service.reissueRecoveryConfirm({ recoveryToken: second.recoveryToken, downloadConfirmed: true }, f.ctx), { code: 'recovery_confirmation_required' });
  assert.equal(recoveryCredential(await f.identity()).fileId, f.file.fileId);
  const recovered = await f.service.recover({ recoveryToken: f.file.recoveryToken, turnstileToken: 'ok' }, base);
  assert.equal(recovered.resumed, false, 'the old file still recovers before acknowledgement');
});

test('7-day gap after a reissue: no file starts a recovery; the previous v3 file can only cancel; after the gap the new file recovers', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp();
  const staged = f.parse(await f.begin()); const done = await f.confirm(staged);
  assert.equal(done.usableAt, f.now() + 7 * DAY);
  await assert.rejects(f.recover(staged), { code: 'recovery_not_ready' });
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_pending' });
  // A reissue confirmed with a passkey that is not file-proof (enrolled no earlier than the previous file was issued)
  // stays cancellable by the previous file (see fileProofReissue).
  const cancelled = await f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken }, { origin: ORIGIN, remoteIP: '127.0.0.1' });
  assert.deepEqual(cancelled, { cancelled: true, restored: true });
  const record = await f.identity(); assert.equal(record.recoveryFileId, f.file.fileId); assert.equal(record.recoveryBackupVersion, 3);
  await assert.rejects(f.recover(staged), { code: 'unauthorized' }, 'the voided file never becomes current');
  assert.ok(await f.recover(f.file), 'the restored file recovers at once');
});

test('a reissue confirmed with a file-proof passkey (enrolled before the previous file, no recent channel removal) cannot be cancelled by that file', async t => {
  const f = await reissueFixture(t); await f.age();
  await f.patch(a => ({ ...a, credentials: a.credentials.map(c => ({ ...c, createdAt: a.recoveryIssuedAt - DAY })) })); await f.stepUp();
  const staged = f.parse(await f.begin()); await f.confirm(staged);
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, true); assert.equal((await f.owner()).recovery.pendingReissue.previousFileCanCancel, false);
  await assert.rejects(f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken }, { origin: ORIGIN, remoteIP: '127.0.0.1' }), { code: 'reissue_cancel_not_allowed' });
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_locked' });
});

test('the annual reminder schedule: upcoming 30 days before the anniversary, due on it, then overdue every 30 days (pure)', async () => {
  assert.equal(RECOVERY_REMINDER_PERIOD_MS, 365 * DAY); assert.equal(RECOVERY_REMINDER_LEAD_MS, 30 * DAY); assert.equal(RECOVERY_REMINDER_REPEAT_MS, 30 * DAY);
  const issued = 1_000_000_000_000, A = issued + 365 * DAY;
  assert.deepEqual(recoveryReminder(issued, issued), { stage: 'none', slot: -1, anniversaryAt: A, nextAt: A - 30 * DAY });
  assert.deepEqual(recoveryReminder(issued, A - 30 * DAY - 1).stage, 'none');
  assert.deepEqual(recoveryReminder(issued, A - 30 * DAY), { stage: 'upcoming', slot: 0, anniversaryAt: A, nextAt: A });
  assert.deepEqual(recoveryReminder(issued, A), { stage: 'due', slot: 1, anniversaryAt: A, nextAt: A + 30 * DAY });
  assert.deepEqual(recoveryReminder(issued, A + 30 * DAY - 1).slot, 1);
  assert.deepEqual(recoveryReminder(issued, A + 30 * DAY), { stage: 'overdue', slot: 2, anniversaryAt: A, nextAt: A + 60 * DAY });
  assert.throws(() => recoveryReminder(-1, 0)); assert.throws(() => recoveryReminder(0, 0.5));
  // Seeded: slots never decrease with time, nextAt is always in the future, and every slot boundary is hit exactly.
  await forEachSeed(200, random => {
    const rng = random.next, start = Math.floor(rng() * 2 ** 40), a = Math.floor(rng() * 800 * DAY), b = a + Math.floor(rng() * 400 * DAY);
    const x = recoveryReminder(start, start + a), y = recoveryReminder(start, start + b);
    assert.ok(y.slot >= x.slot); assert.ok(x.nextAt > start + a); assert.ok(y.nextAt > start + b);
    assert.equal(recoveryReminder(start, x.nextAt).slot, x.slot + 1);
  });
});

test('sendRecoveryReminder: once per slot of the current file, by email and push; a reminder changes no credential; pending windows and new files reset it', async t => {
  const f = await reissueFixture(t), issuedAt = (await f.identity()).recoveryIssuedAt;
  const reminders = () => f.mail.filter(m => m.type === 'recovery-reissue-reminder');
  assert.deepEqual(await f.service.sendRecoveryReminder(f.id), { sent: false, nextAt: issuedAt + 335 * DAY });
  f.advance(issuedAt + 335 * DAY - f.now());
  const before = await f.identity();
  const first = await f.service.sendRecoveryReminder(f.id);
  assert.equal(first.sent, true); assert.equal(first.stage, 'upcoming'); assert.deepEqual(first.notified, { email: true, push: true });
  assert.deepEqual(reminders(), [{ email: 'owner@reissue.example', type: 'recovery-reissue-reminder', owner: f.id, stage: 'upcoming', anniversaryAt: issuedAt + 365 * DAY }]);
  assert.deepEqual(f.push.at(-1), { owner: f.id, event: 'recovery-reissue-reminder' });
  let after = await f.identity();
  assert.equal(after.recoveryHash, before.recoveryHash); assert.equal(after.recoveryFileId, before.recoveryFileId); assert.equal(after.security.epoch, before.security.epoch, 'a reminder is not a security change');
  assert.equal((await f.service.sendRecoveryReminder(f.id)).sent, false, 'the same slot is never sent twice');
  assert.equal(f.service.recoveryView(await f.identity(), null).reminder.stage, 'upcoming', 'the console banner reads the same schedule');
  f.advance(30 * DAY); assert.equal((await f.service.sendRecoveryReminder(f.id)).stage, 'due');
  f.advance(30 * DAY); assert.equal((await f.service.sendRecoveryReminder(f.id)).stage, 'overdue');
  f.advance(10 * DAY); assert.equal((await f.service.sendRecoveryReminder(f.id)).sent, false);
  assert.equal(reminders().length, 3);
  // A pending replacement suppresses reminders; the new file restarts the schedule.
  const ctx = await f.secondSession(); await f.age(); await f.stepUp('passkey', ctx); const staged = f.parse(await f.begin(undefined, ctx)); await f.confirm(staged, {}, ctx);
  assert.equal((await f.service.sendRecoveryReminder(f.id)).sent, false); assert.equal((await f.owner(ctx)).recovery.reminder, null);
  f.advance(RECOVERY_REISSUE_WINDOW_MS);
  const fresh = await f.service.sendRecoveryReminder(f.id); assert.equal(fresh.sent, false); assert.equal(fresh.nextAt, f.now() - RECOVERY_REISSUE_WINDOW_MS + 335 * DAY);
  after = await f.identity(); assert.equal(after.recoveryReminder, undefined, 'the old file\'s reminder record went with it');
  // No credential, no reminder.
  await f.patch(a => ({ ...a, recoveryHash: null }));
  assert.deepEqual(await f.service.sendRecoveryReminder(f.id), { sent: false });
});

test('check-up by file id: the console\'s current id matches the saved file\'s header; the previous file is told apart during a window', async t => {
  const f = await reissueFixture(t);
  const file = await encrypt(f.file.payload), view = (await f.owner()).recovery;
  assert.equal(inspectRecoveryFile(JSON.stringify(file)).fileId, view.fileId);
  assert.equal((await decryptRecoveryFile(file, ANSWERS, fast)).fileId, view.fileId);
  await f.age(); await f.stepUp(); const staged = f.parse(await f.begin()); await f.confirm(staged);
  const during = (await f.owner()).recovery;
  assert.equal(during.fileId, staged.fileId); assert.equal(during.pendingReissue.previousFileId, f.file.fileId);
  assert.notEqual(inspectRecoveryFile(JSON.stringify(file)).fileId, during.fileId, 'the old file is not current any more');
});

test('download acknowledgement digest: the exact encrypted bytes, as text or bytes; any change, re-encryption or other file differs', async t => {
  const f = await reissueFixture(t), file = await encrypt(f.file.payload), text = JSON.stringify(file, null, 2);
  const digest = await recoveryFileDigest(text);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(await recoveryFileDigest(new TextEncoder().encode(text)), digest);
  assert.equal(await recoveryFileDigest(new TextEncoder().encode(text).buffer), digest);
  assert.notEqual(await recoveryFileDigest(text.replace('"version": 2', '"version":  2')), digest, 'whitespace edits differ');
  assert.notEqual(await recoveryFileDigest(JSON.stringify(await encrypt(f.file.payload), null, 2)), digest, 'a second encryption of the same payload differs (fresh salt and IV)');
  await assert.rejects(recoveryFileDigest('x'.repeat(128 * 1024 + 1)), { code: 'recovery_file_invalid' });
  await assert.rejects(recoveryFileDigest(5), { code: 'recovery_file_invalid' });
});

test('organization files are v3 too: bound by credential hash and file id, no keys', async t => {
  const { identityBackupPort } = await import('../packages/runtime/identity-backup.mjs');
  const port = identityBackupPort({ config: { APP_ORIGIN: ORIGIN }, accounts: { get() { throw new Error('no account call'); } } });
  const org = '1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d', token = `${org}.${'C'.repeat(43)}`;
  const issued = await port.issue({ id: org }, token, { issuedAt: 5 });
  assert.deepEqual(Object.keys(issued.file).sort(), ['entity', 'fileId', 'issuedAt', 'issuer', 'recoveryToken', 'version']);
  assert.equal(issued.file.entity, org); assert.equal(issued.fileId, issued.file.fileId); assert.equal(issued.file.issuedAt, 5);
  assert.equal(PRIVATE.test(JSON.stringify(issued.file)), false);
  t.diagnostic('organization recovery files recover nothing until ORG-12 phase B');
});
