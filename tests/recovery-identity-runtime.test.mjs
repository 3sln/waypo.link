import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../apps/node/server.mjs';
import { IdentityService } from '../packages/identity/service.mjs';
import { identityBackupPort } from '../packages/runtime/identity-backup.mjs';
import { verifyNameAssignment } from '../packages/recovery/identity-backup.mjs';
import { validateRecoveryPayload } from '../packages/recovery/index.mjs';

// Recovery file v3 over the durable Node runtime and its HTTP routes (owner approval 2026-10-28): an opaque credential,
// no keys, no provider proof; envelope v1 credentials (payloads v1 and v2) recover nothing.

const origin = 'http://localhost:8788';
const password = 'Portable recovery runtime test password!';
const challenge = 'local-browser-test-token';
// Compare sensitive persisted records without printing their contents on failure.
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decoded = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

async function fixture(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'identity-recovery-runtime-'));
  let app = await createNodeServer({ directory, config });
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, input, headers = {}, method = 'POST') => {
    const response = await app.fetch(new Request(origin + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      ...input === undefined ? {} : { body: JSON.stringify(input) }
    }));
    return { response, status: response.status, value: await response.json() };
  };
  return {
    directory, request, get app() { return app; },
    async restart() { await app.close(); app = await createNodeServer({ directory, config }); },
    async signup() {
      const result = await request('/api/auth/signup', { method: 'password', password, ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: challenge });
      assert.equal(result.status, 200, result.value.error);
      return result.value;
    },
    async download(pendingToken) {
      const result = await request('/api/auth/recovery/download', { pendingToken });
      assert.equal(result.status, 200, result.value.error);
      return { ...result.value, payload: JSON.parse(result.value.content) };
    },
    async activate(pendingToken, recoveryToken) {
      const result = await request('/api/auth/recovery/confirm', { pendingToken, recoveryToken, downloadConfirmed: true });
      assert.equal(result.status, 200, result.value.error);
      return { ...result.value, headers: { Cookie: result.response.headers.get('Set-Cookie').split(';')[0], 'X-CSRF-Token': result.value.csrfToken } };
    },
    async recover(file, overrides = {}) {
      return request('/api/auth/recover', { recoveryToken: file.recoveryToken, turnstileToken: challenge, ...overrides });
    }
  };
}

const signingHistory = async (f, id) => digest((await f.app.resources.accounts.get(id).identityKeyHistory(id, { purpose: 'signing' })).map(k => [k.kid, k.state]));

test('durable v3 recovery across restart and return: no keys in the file, the signer never changes, name certificates stay separate', async t => {
  const f = await fixture(t), pending = await f.signup();
  const accountId = pending.account.id, assignedHandle = pending.account.handle;
  const originalSigner = await f.app.resources.accounts.get(accountId).signingKey(accountId);
  const file = await f.download(pending.pendingToken), payload = validateRecoveryPayload(file.payload);
  assert.deepEqual(Object.keys(file.payload).sort(), ['entity', 'fileId', 'issuedAt', 'issuer', 'recoveryToken', 'version']);
  assert.equal(payload.version, 3); assert.equal(payload.issuer, origin); assert.equal(payload.entity, accountId); assert.equal(payload.fileId, file.fileId);
  assert.equal(file.content.includes('privateJWK'), false); assert.equal(file.content.includes(originalSigner.kid), false);
  const authorityPath = join(f.directory, 'recovery-signing-key');
  assert.equal((await stat(authorityPath)).mode & 0o777, 0o600);
  const authorityText = await readFile(authorityPath, 'utf8');
  const authority = JSON.parse(authorityText), { d, key_ops, ...publicKey } = authority.privateJWK;
  const owner = await f.activate(pending.pendingToken, file.recoveryToken);
  const certificateResponse = await f.request('/api/auth/handles/certificate', {}, owner.headers);
  assert.equal(certificateResponse.status, 200, certificateResponse.value.error);
  const assignment = JSON.parse(certificateResponse.value.content);
  await verifyNameAssignment(assignment, { kid: authority.kid, publicKey }, { issuer: origin, entity: accountId, handle: assignedHandle });
  for (const value of [assignment, decoded(assignment.proof.payload)]) { assert.equal(value.recoveryToken, undefined); assert.equal(value.fileId, undefined); }
  const beforeKeys = await signingHistory(f, accountId);
  await f.restart();
  assert.equal(digest(await readFile(authorityPath, 'utf8')), digest(authorityText));
  const recovered = await f.recover(file);
  assert.equal(recovered.status, 200, recovered.value.error);
  assert.equal(recovered.value.account.id, accountId); assert.equal(recovered.value.account.handle, assignedHandle);
  assert.equal((await f.request('/api/session', undefined, owner.headers, 'GET')).value.authenticated, false);
  const pendingToken = recovered.value.pendingToken;
  assert.equal((await f.request('/api/auth/password/pending', { pendingToken, password })).status, 200);
  const replacement = await f.download(pendingToken);
  assert.notEqual(replacement.fileId, file.fileId);
  assert.equal(await signingHistory(f, accountId), beforeKeys, 'the replacement file rotates nothing (P15 withdrawn)');
  // An interrupted recovery can resume from the original file even after replacement issuance.
  const resumed = await f.recover(file);
  assert.equal(resumed.status, 200, resumed.value.error); assert.equal(resumed.value.resumed, true); assert.equal(resumed.value.credentialRequired, false);
  const returned = await f.activate(resumed.value.pendingToken, replacement.recoveryToken);
  assert.equal(returned.account.id, accountId);
  const returnedCertificate = await f.request('/api/auth/handles/certificate', {}, returned.headers);
  assert.equal(JSON.parse(returnedCertificate.value.content).assignmentId, assignment.assignmentId);
  const view = await f.request('/api/account', undefined, returned.headers, 'GET');
  assert.equal(view.value.recovery.fileId, replacement.fileId); assert.equal(view.value.recovery.version, 3);
  const beforeReplay = digest(await f.app.resources.repository.get(accountId));
  const replay = await f.recover(file);
  assert.equal(replay.status, 401); assert.equal(replay.value.error, 'unauthorized');
  assert.equal(digest(await f.app.resources.repository.get(accountId)), beforeReplay);
});

test('forged or altered credentials reject without changing identity or key metadata; v2 extras are irrelevant', async t => {
  const f = await fixture(t), pending = await f.signup();
  const file = await f.download(pending.pendingToken);
  await f.activate(pending.pendingToken, file.recoveryToken);
  const controller = f.app.resources.accounts.get(pending.account.id);
  const identityBefore = digest(await f.app.resources.repository.get(pending.account.id));
  const metadataBefore = digest([...await controller.metadata.list({})]);
  const flipped = file.recoveryToken.slice(0, -1) + (file.recoveryToken.endsWith('A') ? 'B' : 'A');
  for (const recoveryToken of [flipped, `${pending.account.id}.${'Z'.repeat(43)}`, file.payload.fileId, '']) {
    const result = await f.recover(file, { recoveryToken });
    assert.ok([400, 401].includes(result.status), String(result.status));
    assert.equal(digest(await f.app.resources.repository.get(pending.account.id)), identityBefore);
    assert.equal(digest([...await controller.metadata.list({})]), metadataBefore);
  }
});

test('a file cannot reconstruct a missing account', async t => {
  const f = await fixture(t), pending = await f.signup();
  const file = await f.download(pending.pendingToken);
  await f.activate(pending.pendingToken, file.recoveryToken);
  const id = pending.account.id;
  await f.app.resources.repository.metadata.delete(`account/${id}`);
  const identityRows = digest([...await f.app.resources.repository.metadata.list({})]);
  const missingAccount = await f.recover(file);
  assert.equal(missingAccount.status, 401);
  assert.equal(await f.app.resources.repository.get(id), undefined);
  assert.equal(digest([...await f.app.resources.repository.metadata.list({})]), identityRows);
});

test('issuing a file needs no provider signing authority; setup provisions the signing key once and never rotates it', async t => {
  const f = await fixture(t), pending = await f.signup();
  const repository = f.app.resources.repository, accounts = f.app.resources.accounts;
  const service = new IdentityService({ repository, identityBackup: identityBackupPort({ config: { APP_ORIGIN: origin }, accounts }),
    turnstile: {}, rateLimiter: { check: async () => true }, webauthn: {}, passwordHasher: {},
    config: { origin, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  const result = await service.downloadRecovery({ pendingToken: pending.pendingToken }, { origin });
  assert.equal(validateRecoveryPayload(result.content).fileId, result.fileId);
  assert.equal((await repository.get(pending.account.id)).recoveryFileId, result.fileId);
  const keys = await signingHistory(f, pending.account.id);
  assert.equal((await accounts.get(pending.account.id).identityKeyHistory(pending.account.id, { purpose: 'signing' })).length, 1, 'the identity signing key exists after setup');
  await service.downloadRecovery({ pendingToken: pending.pendingToken }, { origin });
  assert.equal(await signingHistory(f, pending.account.id), keys, 'a second issuance rotates nothing');
});

test('a legacy (unmarked or v2) credential and a legacy resume authority recover nothing; a new file is required', async t => {
  for (const version of [undefined, 2]) {
    const f = await fixture(t), pending = await f.signup();
    const file = await f.download(pending.pendingToken);
    const owner = await f.activate(pending.pendingToken, file.recoveryToken);
    const repository = f.app.resources.repository, id = pending.account.id;
    const legacy = await repository.get(id);
    delete legacy.recoveryFileId; if (version) legacy.recoveryBackupVersion = version; else delete legacy.recoveryBackupVersion;
    await repository.metadata.put(`account/${id}`, legacy);
    assert.equal((await f.recover(file)).status, 401);
    const view = await f.request('/api/account', undefined, owner.headers, 'GET');
    assert.equal(view.value.recovery.reissueRequired, 'legacy-format');
    // A recovery in progress under a legacy resume authority does not resume either.
    const recovering = { ...await repository.get(id), status: 'recovering', recoveryResumeHash: legacy.recoveryHash, recoveryResumeBackupVersion: version ?? 1, recoveryHash: null };
    await repository.metadata.put(`account/${id}`, recovering);
    assert.equal((await f.recover(file)).status, 401);
  }
});

test('a retained verified-payment marker permits one numeric custom name after cancellation without replacing identity recovery', async t => {
  const f = await fixture(t, { BILLING_ENABLED: 'true', POLAR_SERVER: 'sandbox', POLAR_PRODUCT_ID_PAID: 'fixture-paid', POLAR_PRODUCT_ID_PLUS: 'fixture-plus', POLAR_PRODUCT_ID_ULTRA: 'fixture-ultra', POLAR_ACCESS_TOKEN: 'fixture-only-access', POLAR_WEBHOOK_SECRET: 'fixture-only-webhook' });
  const pending = await f.signup(), file = await f.download(pending.pendingToken), owner = await f.activate(pending.pendingToken, file.recoveryToken);
  const id = owner.account.id, controller = f.app.resources.accounts.get(id), repository = f.app.resources.repository;
  // This is a local persisted-evidence fixture. Provider-order verification is
  // covered separately; these rows do not assert a real payment occurred.
  await controller.metadata.put(`billing/ever-paid/sandbox/${id}`, { version: 1, source: 'polar', owner: id, server: 'sandbox', organizationId: 'fixture-org', plan: 'plus', productId: 'fixture-plus', orderId: 'fixture-paid-order', subscriptionId: 'fixture-ended-subscription', verifiedAt: Date.now() - 86400000 });
  await controller.metadata.put('billing/state', { owner: id, source: 'polar', plan: 'free', status: 'canceled', validUntil: Date.now() - 1000 });
  const recoveryBefore = (await repository.get(id)).recoveryHash, keychainBefore = await signingHistory(f, id);
  await f.restart();
  const freshLogin=await f.request('/api/auth/login/password',{handle:owner.account.handle,password,turnstileToken:challenge});assert.equal(freshLogin.status,200,freshLogin.value.error);
  const freshHeaders={Cookie:freshLogin.response.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':freshLogin.value.csrfToken};
  const claim = await f.request('/api/auth/handles/claim', { handle: '123' }, freshHeaders);
  assert.equal(claim.status, 200, claim.value.error);
  assert.equal(claim.value.account.id, id);
  assert.equal(claim.value.account.handle, owner.account.handle);
  assert.equal(claim.value.account.paidHandle, '123');
  assert.equal((await f.app.resources.repository.get(id)).recoveryHash, recoveryBefore);
  assert.equal(await signingHistory(f, id), keychainBefore);
  assert.equal((await f.request('/api/auth/handles/claim', { handle: '123' }, freshHeaders)).status, 200);
  assert.equal((await f.request('/api/auth/handles/claim', { handle: '456' }, freshHeaders)).value.error, 'handle_already_claimed');
  const authority = await f.request('/api/recovery/authority', undefined, {}, 'GET');
  assert.equal(authority.status, 200);
  const certificate = await f.request('/api/auth/handles/certificate', { handle: '123' }, freshHeaders);
  assert.equal(certificate.status, 200, certificate.value.error);
  const publicClaim = JSON.parse(certificate.value.content);
  await verifyNameAssignment(publicClaim, authority.value, { issuer: origin, entity: id, handle: '123' });
  for (const value of [publicClaim, decoded(publicClaim.proof.payload)]) {
    assert.equal(value.recoveryToken, undefined);
    assert.equal(value.keychain, undefined);
  }
  const login = await f.request('/api/auth/login/password', { handle: '123', password, turnstileToken: challenge });
  assert.equal(login.status, 200, login.value.error);
  assert.equal(login.value.account.id, id);
  const recovery = await f.recover(file);
  assert.equal(recovery.status, 200, recovery.value.error);
  assert.equal(recovery.value.account.id, id);
  assert.equal(recovery.value.account.paidHandle, '123');
});

test('equivalent Crockford login spellings share the same handle abuse window', async () => {
  const attempts = [], lookups = [];
  const service = new IdentityService({ repository: { findByHandle: async handle => { lookups.push(handle); return null; } },
    turnstile: { verify: async () => true }, rateLimiter: { check: async input => { attempts.push(input); return true; } },
    webauthn: { authenticationOptions: async () => ({ challenge: 'fixture-challenge' }) }, passwordHasher: { hash: async () => 'fixture-hash', verify: async () => false },
    config: { origin, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  for (const handle of ['N.OI', 'n.0001']) {
    await assert.rejects(service.loginPassword({ handle, password, turnstileToken: challenge }, { origin }), { code: 'unauthorized' });
    await service.beginPasskeyLogin({ handle, turnstileToken: challenge }, { origin });
  }
  // Wargame 2026-10-23 #3/#9: the pre-Turnstile window is per network only; the handle window is consulted and charged
  // (a failed check) under the canonical spelling; passkey begin neither touches the handle window nor looks it up.
  assert.deepEqual(attempts.map(input => [input.phase ?? null, input.handle ?? null]), [['attempt', null], ['credential', 'n.1'], ['failure', 'n.1'], ['attempt', null], ['attempt', null], ['credential', 'n.1'], ['failure', 'n.1'], ['attempt', null]]);
  assert.deepEqual(lookups, ['n.1', 'n.1']);
});
