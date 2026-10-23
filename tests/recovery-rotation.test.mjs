// PORT-10, rotation at recovery-file issuance (identity portability P15, P14; design §2.5 "Interim: rotate at reissue").
// Every downloadRecovery that may supersede an earlier file rotates the signing key with keys.mjs continuity before
// issuing, so a superseded file holds a retired key that signs nothing honoured; the credential's issuance time and
// the bound key are recorded in the same identity CAS; a full history of referenced keys issues without rotating and
// audits it. Runs through the durable Node runtime (real account objects, real identity repository), plus a seeded
// chaos schedule over the identity service with scheduler-wrapped repository and account ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../apps/node/server.mjs';
import { IdentityService, recoveryCredential } from '../packages/identity/service.mjs';
import { identityBackupPort } from '../packages/runtime/identity-backup.mjs';
import { verifyKeyContinuity, KEY_HISTORY_LIMIT } from '../packages/identity/keys.mjs';
import { key } from '../packages/core/records.mjs';
import { signContactToken } from '../packages/messaging/contact-tokens.mjs';
import { forEachSeed, createScheduler } from './helpers/chaos.mjs';

const origin = 'http://localhost:8788', password = 'Portable recovery rotation test password!', challenge = 'local-browser-test-token';
const headerOf = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
const linkInput = { name: 'Friends', mimeTypes: ['text/plain'], expiresAt: Date.now() + 86400000, maxMessages: 50, maxBytes: 65536, maxMessageBytes: 4096 };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-rotation-'));
  const app = await createNodeServer({ directory, config: {} });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, input) => { const response = await app.fetch(new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); return { status: response.status, value: await response.json() }; };
  const signup = async () => { const result = await request('/api/auth/signup', { method: 'password', password, ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: challenge }); assert.equal(result.status, 200, result.value.error); return result.value; };
  const download = async pendingToken => { const result = await request('/api/auth/recovery/download', { pendingToken }); assert.equal(result.status, 200, result.value.error); return { ...result.value, backup: JSON.parse(result.value.content) }; };
  const activate = async (pendingToken, recoveryToken) => { const result = await request('/api/auth/recovery/confirm', { pendingToken, recoveryToken, downloadConfirmed: true }); assert.equal(result.status, 200, result.value.error); return result.value; };
  const recover = file => request('/api/auth/recover', { recoveryToken: file.recoveryToken, identityBackup: file.backup, turnstileToken: challenge });
  const identity = id => app.resources.repository.get(id);
  return { directory, app, request, signup, download, activate, recover, identity, controller: id => app.resources.accounts.get(id) };
}
const audits = account => account.audit.map(entry => entry.type);
const state = async (c, owner, kid) => (await c.identitySigningKey(owner, kid))?.state;

test('the first file adopts the signer; every later issuance rotates with continuity; the credential time and bound key are recorded', async t => {
  const f = await fixture(t), pending = await f.signup(), id = pending.account.id, c = f.controller(id);
  const signer = (await c.signingKey(id)).kid;
  const first = await f.download(pending.pendingToken);
  assert.equal(first.backup.keychain.signing.kid, signer, 'a new identity\'s first file adopts the existing signer');
  let record = await f.identity(id);
  assert.equal(record.recoveryKeyKid, signer); assert.ok(Number.isSafeInteger(record.recoveryIssuedAt));
  assert.equal(recoveryCredential(record), null, 'no current credential before activation');
  assert.equal(audits(record).includes('recovery-key-rotated'), false);
  const second = await f.download(pending.pendingToken), k1 = second.backup.keychain.signing.kid;
  assert.notEqual(k1, signer, 'a re-download supersedes the first file and rotates first');
  assert.equal(second.backup.keychain.encryption.kid, first.backup.keychain.encryption.kid);
  assert.equal(await state(c, id, signer), 'retired'); assert.equal(await state(c, id, k1), 'active');
  const history = await c.identityKeyHistory(id, { purpose: 'signing' }), next = history.find(k => k.kid === k1);
  assert.equal(await verifyKeyContinuity({ signer: history.find(k => k.kid === signer), next, subject: id }), true, 'the old key signs the new key');
  record = await f.identity(id);
  assert.equal(record.recoveryKeyKid, k1); assert.ok(audits(record).includes('recovery-key-rotated'));
  // The superseded file restores nothing: its credential is gone and its key is retired.
  await f.activate(pending.pendingToken, second.recoveryToken);
  record = await f.identity(id);
  assert.deepEqual(recoveryCredential(record), { issuedAt: record.recoveryIssuedAt, version: 2, keyKid: k1 });
  assert.equal((await f.recover(first)).status, 401);
  assert.equal((await f.recover(second)).status, 200, 'the current file recovers');
});

test('the replacement file after a recovery rotates; old contact links keep working; the old file\'s key signs nothing honoured', async t => {
  const f = await fixture(t), pending = await f.signup(), id = pending.account.id, c = f.controller(id);
  const file = await f.download(pending.pendingToken); await f.activate(pending.pendingToken, file.recoveryToken);
  const link = await c.createContactLink(id, pending.account.handle, linkInput), k0 = file.backup.keychain.signing.kid;
  const oldKey = await c.signingKey(id); assert.equal(oldKey.kid, k0);
  const grant = await c.metadata.get(key('contact-grant', link.id));
  const started = await f.recover(file); assert.equal(started.status, 200, started.value.error);
  assert.equal((await f.request('/api/auth/password/pending', { pendingToken: started.value.pendingToken, password })).status, 200);
  const replacement = await f.download(started.value.pendingToken), k1 = replacement.backup.keychain.signing.kid;
  assert.notEqual(k1, k0); assert.equal(await state(c, id, k0), 'retired');
  let record = await f.identity(id);
  assert.equal(record.recoveryKeyKid, k1); assert.equal(record.recoveryResumeKeyKid, k0);
  // An interrupted recovery resumes from the original file even though its key is now retired.
  const resumed = await f.recover(file); assert.equal(resumed.status, 200, resumed.value.error); assert.equal(resumed.value.resumed, true);
  await f.activate(resumed.value.pendingToken, replacement.recoveryToken);
  record = await f.identity(id); assert.equal(record.recoveryResumeKeyKid, undefined, 'activation removes the resume binding');
  assert.equal((await f.recover(file)).status, 401, 'the consumed file never recovers again');
  // Links recorded before the rotation keep verifying and mint bearers under the current key.
  assert.equal((await c.endpoints.inspect(link.url)).form, 'link');
  const bearer = await c.endpoints.mintDelivery(link.url);
  assert.equal(headerOf(bearer.token).kid, k1); assert.ok(await c.endpoints.verifyDelivery(bearer.token));
  // The old file's key: a bearer over exact claims is refused; fresh signatures resolve inactive.
  const now = Math.floor(Date.now() / 1000), forged = await signContactToken({ header: { alg: 'ES256', kid: k0, typ: 'bindle-contact-delivery+jwt' }, claims: c.endpoints.deliveryClaims(grant, { jti: crypto.randomUUID(), iat: now, exp: now + 300 }), privateKey: oldKey.privateKey });
  await assert.rejects(c.endpoints.verifyDelivery(forged), { code: 'unauthorized' });
  assert.equal((await c.identityKey(id, k0)).active, false);
  assert.equal((await f.recover(replacement)).status, 200);
});

test('a lost identity commit after the account rotated leaves the current file usable; the next issuance does not rotate again', async t => {
  const f = await fixture(t), pending = await f.signup(), id = pending.account.id, c = f.controller(id), repository = f.app.resources.repository;
  const file = await f.download(pending.pendingToken), k0 = file.backup.keychain.signing.kid;
  const cas = repository.compareAndSwap; repository.compareAndSwap = async () => { repository.compareAndSwap = cas; return false; };
  const lost = await f.request('/api/auth/recovery/download', { pendingToken: pending.pendingToken });
  assert.equal(lost.status, 409, 'the issuance whose identity commit lost returns no file');
  const k1 = (await c.signingKey(id)).kid; assert.notEqual(k1, k0, 'the account rotation had committed');
  assert.equal((await f.identity(id)).recoveryKeyKid, k0, 'the credential still binds the earlier file');
  await f.activate(pending.pendingToken, file.recoveryToken);
  const recovered = await f.recover(file); assert.equal(recovered.status, 200, 'the current file, holding a bound retired key, still recovers');
  assert.equal((await f.request('/api/auth/password/pending', { pendingToken: recovered.value.pendingToken, password })).status, 200);
  const replacement = await f.download(recovered.value.pendingToken);
  assert.equal(replacement.backup.keychain.signing.kid, k1, 'k1 is in no issued file, so it is issued without another rotation');
  // A rotation outside issuance still makes every older file unusable (no rollback).
  await f.activate(recovered.value.pendingToken, replacement.recoveryToken);
  await c.rotateIdentityKey(id, { purpose: 'signing', expectedKid: k1 });
  assert.equal((await f.recover(replacement)).status, 401);
});

test('a full history of referenced keys issues without rotating and audits it (P15 known edge)', async t => {
  const f = await fixture(t), pending = await f.signup(), id = pending.account.id, c = f.controller(id);
  let file = await f.download(pending.pendingToken);
  // Each issuance rotates; a live contact link then references the outgoing key, so nothing may be pruned.
  for (let i = 1; i < KEY_HISTORY_LIMIT; i++) { await c.createContactLink(id, pending.account.handle, { ...linkInput, name: `L${i}` }); file = await f.download(pending.pendingToken); }
  await c.createContactLink(id, pending.account.handle, { ...linkInput, name: 'last' });
  assert.equal((await c.identityKeyHistory(id, { purpose: 'signing' })).length, KEY_HISTORY_LIMIT);
  const full = await f.download(pending.pendingToken);
  assert.equal(full.backup.keychain.signing.kid, file.backup.keychain.signing.kid, 'issued without rotating');
  const record = await f.identity(id);
  assert.equal(audits(record).at(-2), 'recovery-key-rotation-skipped'); assert.equal(audits(record).at(-1), 'recovery-file-issued');
  assert.equal((await c.identityKeyHistory(id, { purpose: 'signing' })).length, KEY_HISTORY_LIMIT, 'no referenced key was pruned');
  await f.activate(pending.pendingToken, full.recoveryToken);
  assert.equal((await f.recover(full)).status, 200);
});

test('seeded chaos: concurrent issuance, resumption, bearer minting and inspection keep exactly one current file and honour no superseded key', async t => {
  await forEachSeed(8, async random => {
    // A fresh runtime per seed, so the server's per-network signup and recovery limits never interfere.
    const f = await fixture(t), authority = await readFile(join(f.directory, 'recovery-signing-key'), 'utf8');
    const pending = await f.signup(), id = pending.account.id, c = f.controller(id);
    const file = await f.download(pending.pendingToken); await f.activate(pending.pendingToken, file.recoveryToken);
    const link = await c.createContactLink(id, pending.account.handle, linkInput);
    const started = await f.recover(file); assert.equal(started.status, 200);
    assert.equal((await f.request('/api/auth/password/pending', { pendingToken: started.value.pendingToken, password })).status, 200);
    const scheduler = createScheduler(random), repository = scheduler.wrap(f.app.resources.repository, 'identity');
    const accounts = { get: owner => scheduler.wrap(f.app.resources.accounts.get(owner), 'account') };
    const service = new IdentityService({ repository, identityBackup: identityBackupPort({ config: { APP_ORIGIN: origin, RECOVERY_SIGNING_KEY: authority }, accounts }),
      turnstile: { verify: async () => true }, rateLimiter: { check: async () => true }, webauthn: {}, passwordHasher: {},
      config: { origin, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
    const context = { origin, remoteIP: '127.0.0.1' }, issued = [];
    const downloadTask = () => service.downloadRecovery({ pendingToken: started.value.pendingToken }, context).then(result => { issued.push({ recoveryToken: result.recoveryToken, backup: JSON.parse(result.content) }); return result; });
    const work = random.shuffle([downloadTask, downloadTask, downloadTask,
      () => random.chance(0.5) ? service.recover({ recoveryToken: file.recoveryToken, identityBackup: file.backup, turnstileToken: challenge }, context) : Promise.resolve(null),
      () => c.endpoints.mintDelivery(link.url).then(bearer => c.endpoints.verifyDelivery(bearer.token).catch(error => { if (error.code !== 'unauthorized') throw error; })),
      () => c.endpoints.inspect(link.url)]);
    const results = await scheduler.run(work);
    for (const result of results) if (result.status === 'rejected') assert.ok(['conflict', 'unauthorized', 'key_conflict'].includes(result.reason?.code), `unexpected ${result.reason?.code}: ${result.reason?.message} ${scheduler.trace.join(' | ')}`);
    const record = await f.identity(id), current = (await c.signingKey(id)).kid;
    const winners = [];
    for (const one of issued) if (record.recoveryHash === await service.crypto.hash('recovery', one.recoveryToken)) winners.push(one);
    assert.ok(winners.length <= 1, 'at most one returned file is current');
    if (winners.length) {
      const [winner] = winners;
      assert.equal(winner.backup.keychain.signing.kid, record.recoveryKeyKid, 'the credential binds its own file\'s key');
      for (const other of issued.filter(one => one !== winner)) if (other.backup.keychain.signing.kid !== winner.backup.keychain.signing.kid) assert.equal(await state(c, id, other.backup.keychain.signing.kid), 'retired', 'a superseded file never holds the current key');
    }
    for (const one of issued) assert.notEqual(await state(c, id, one.backup.keychain.signing.kid), 'revoked');
    // The original file still resumes; activation with the current file then makes it the only recovery credential.
    const resumed = await f.recover(file); assert.equal(resumed.status, 200, resumed.value.error);
    const finalFile = winners[0] ?? await f.download(resumed.value.pendingToken);
    await f.activate(resumed.value.pendingToken, finalFile.recoveryToken);
    assert.equal((await f.recover(file)).status, 401);
    for (const one of issued.filter(other => other !== finalFile)) assert.equal((await f.recover(one)).status, 401, 'superseded files never recover');
    assert.equal((await c.endpoints.inspect(link.url)).form, 'link', 'the pre-rotation link survives');
    const bearer = await c.endpoints.mintDelivery(link.url); assert.equal(headerOf(bearer.token).kid, (await c.signingKey(id)).kid); assert.ok(await c.endpoints.verifyDelivery(bearer.token));
    assert.notEqual((await c.signingKey(id)).kid, undefined); assert.ok(current);
    assert.equal((await f.recover(finalFile)).status, 200, 'the final current file recovers');
  });
});
