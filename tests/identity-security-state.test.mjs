// DX-6 identity security state (docs/architecture/account-deletion-export.md §2.1, R1-H1): every security-sensitive
// identity CAS bumps `security:{epoch, changedAt}` in the same write; nothing else does. Engine level (the real
// IdentityService inside its ngin Engine), over the three repository implementations: the in-memory test
// repository, the Node IdentityRepository (SQLite) and the Worker ShardedIdentityRepository (shard storage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, MemoryAccounts, memoryShards, signupInput, sessionContext, context, PASSWORD } from './helpers/identity-engine.mjs';
import { fakeClock, forEachSeed, createScheduler } from './helpers/chaos.mjs';
import { SECURITY_EVENTS, securityState, identitySecurityPort } from '../packages/identity/service.mjs';
import { IdentityRepository } from '../packages/runtime/accounts.mjs';
import { SqliteMetadata } from '../apps/node/resources.mjs';

const MINUTE = 60000, HOUR = 3600000;
const REPOSITORIES = ['memory', 'node', 'worker'];
function baseRepository(kind, t, clock) {
  if (kind === 'memory') return new MemoryAccounts();
  if (kind === 'node') { const metadata = new SqliteMetadata(':memory:'); t.after(() => metadata.close()); return new IdentityRepository({ metadata, config: {} }); }
  return memoryShards().repository(clock.now);
}
// The invariant, checked on every successful write: the epoch moves by exactly one iff the write changed a
// security-relevant field (or resumed a recovery), changedAt never moves backwards, and a bump records the
// write's own time. History is keyed by revision, so the check holds under any interleaving.
const fingerprint = a => JSON.stringify([a.verifiedEmail ?? null, (a.credentials ?? []).map(c => c.id).sort(), a.passwordHash ?? null, a.recoveryHash ?? null, a.noticeWaiver ?? null]);
function audited(repository, clock) {
  const history = new Map(), violations = [], writes = [];
  const remember = account => { if (!history.has(account.id)) history.set(account.id, new Map()); history.get(account.id).set(account.revision, structuredClone(account)); };
  const check = (old, next) => {
    const before = securityState(old), after = securityState(next), seen = new Set((old.audit ?? []).map(e => e.id));
    const events = (next.audit ?? []).filter(e => !seen.has(e.id)).map(e => e.type);
    const expected = fingerprint(old) !== fingerprint(next) || (old.emailLoginEnabled !== true && next.emailLoginEnabled === true) || events.includes('recovery-setup-resumed') || events.includes('password-configured');
    const bumped = after.epoch - before.epoch;
    writes.push({ events, bumped });
    if (bumped !== (expected ? 1 : 0)) violations.push(`events ${events.join(',') || '(none)'}: epoch ${before.epoch}→${after.epoch}, expected bump ${expected}`);
    if (after.changedAt < before.changedAt) violations.push(`changedAt moved backwards on ${events.join(',')}`);
    if (bumped && after.changedAt !== Math.max(before.changedAt, clock.now())) violations.push(`bump time ${after.changedAt} is not the write time`);
    if (bumped && !events.some(e => SECURITY_EVENTS.includes(e))) violations.push(`bump without a security event: ${events.join(',')}`);
  };
  const proxy = new Proxy(repository, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === 'create') return async account => { const ok = await value.call(target, account); if (ok) remember(account); return ok; };
    if (key === 'compareAndSwap') return async (id, revision, account) => { const snapshot = structuredClone(account), ok = await value.call(target, id, revision, account); if (ok) { const old = history.get(id)?.get(revision); if (old) check(old, snapshot); else violations.push(`unseen revision ${revision}`); remember(snapshot); } return ok; };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { repository: proxy, violations, writes };
}
const fakeWebAuthn = () => {
  let n = 0;
  return {
    registrationOptions: async () => ({ challenge: `reg-${++n}` }), authenticationOptions: async () => ({ challenge: `auth-${++n}` }),
    verifyRegistration: async ({ response }) => ({ id: response.id, publicKey: `pk-${response.id}`, counter: 0, deviceType: 'singleDevice', backedUp: false }),
    verifyAuthentication: async ({ credential }) => ({ counter: (credential.counter ?? 0) + 1, backedUp: false }),
  };
};
function harness(t, kind, { clock = fakeClock(), wrap = repository => repository, ...overrides } = {}) {
  const audit = audited(baseRepository(kind, t, clock), clock);
  const h = identityEngine({ repository: wrap(audit.repository), clock, webauthn: fakeWebAuthn(), ...overrides });
  const record = async id => audit.repository.get(id);
  const security = async id => identitySecurityPort(audit.repository)(id);
  return { ...h, audit, record, security, clock };
}
const latestMail = (h, filter = () => true) => h.mail.filter(filter).at(-1);
const mailToken = (h, purpose) => latestMail(h, m => m.purpose === purpose).token;
async function activeAccount(h, input = signupInput()) {
  const pending = await h.act('signup', input);
  const file = await h.act('downloadRecovery', pending);
  const owner = await h.act('confirmRecovery', { ...pending, recoveryToken: file.recoveryToken, downloadConfirmed: true });
  return { id: pending.account.id, handle: pending.account.handle, pending, file, owner, ctx: sessionContext(owner) };
}
async function linkEmail(h, ctx, email) {
  await h.act('emailStart', { email }, ctx);
  return h.act('emailConfirm', { token: mailToken(h, 'link'), confirmed: true }, ctx);
}
/** Runs `fn` and asserts the epoch moved by `bump` (0 or 1) and, on a bump, that changedAt is the call's time. */
async function expectBump(h, id, label, bump, fn) {
  const before = await h.security(id), result = await fn(), after = await h.security(id);
  assert.equal(after.epoch, before.epoch + bump, `${label}: epoch ${before.epoch}→${after.epoch}`);
  assert.equal(after.changedAt, bump ? h.clock.now() : before.changedAt, `${label}: changedAt`);
  return result;
}

test('port contract: legacy records read {0,0}, malformed state fails closed, missing and deleted identities are null', async () => {
  assert.deepEqual(securityState({}), { epoch: 0, changedAt: 0 });
  assert(Object.isFrozen(securityState({ security: { epoch: 3, changedAt: 9 } })));
  for (const security of [null, {}, { epoch: -1, changedAt: 0 }, { epoch: 1.5, changedAt: 0 }, { epoch: 1, changedAt: '0' }, { epoch: Number.MAX_SAFE_INTEGER, changedAt: 0 }])
    assert.throws(() => securityState({ security }), { code: 'identity_security_unavailable', status: 503 }, JSON.stringify(security));
  const id = crypto.randomUUID(), records = new Map([[id, { id, status: 'active', security: { epoch: 2, changedAt: 5 } }]]), port = identitySecurityPort({ get: async key => records.get(key) ?? null });
  assert.deepEqual(await port(id), { epoch: 2, changedAt: 5 });
  assert.equal(await port(crypto.randomUUID()), null);
  records.set(id, { id, status: 'deleted' }); assert.equal(await port(id), null);
  records.set(id, { id: crypto.randomUUID(), status: 'active' }); assert.equal(await port(id), null, 'a record for another owner never answers');
  records.set(id, { id, status: 'active', security: { epoch: 'x' } }); await assert.rejects(port(id), { code: 'identity_security_unavailable' });
  assert.throws(() => identitySecurityPort({}), TypeError);
});

for (const kind of REPOSITORIES) {
  test(`${kind}: every security-sensitive path bumps the epoch in its own CAS; non-security changes never do`, async t => {
    const flags = { for: () => ({ enabled: name => name === 'EMAIL_REMOVAL_ENABLED' }) };
    const h = harness(t, kind, { flags, accountChannels: { state: async () => ({ ready: true, count: 1, revision: 'p1' }), notify: async () => ({ accepted: 1 }) } });
    const tick = (ms = MINUTE / 2) => h.clock.advance(ms);
    // Creation establishes the first credential: epoch 0 at the creation time.
    const pending = await h.act('signup', signupInput()), id = pending.account.id;
    assert.deepEqual(await h.security(id), { epoch: 0, changedAt: h.clock.now() });
    tick(); await expectBump(h, id, 'setPendingPassword', 1, () => h.act('setPendingPassword', { pendingToken: pending.pendingToken, password: PASSWORD }));
    tick(); await h.act('setupEmailStart', { pendingToken: pending.pendingToken, email: 'first@mail.example' });
    let code = latestMail(h, m => m.code).code;
    await expectBump(h, id, 'setupEmailConfirm (new address)', 1, () => h.act('setupEmailConfirm', { pendingToken: pending.pendingToken, code }));
    tick(61000); await h.act('setupEmailStart', { pendingToken: pending.pendingToken, email: 'first@mail.example' }); code = latestMail(h, m => m.code).code;
    await expectBump(h, id, 'setupEmailConfirm (same address)', 0, () => h.act('setupEmailConfirm', { pendingToken: pending.pendingToken, code }));
    tick(); const file = await expectBump(h, id, 'downloadRecovery', 1, () => h.act('downloadRecovery', pending));
    tick(); const owner = await expectBump(h, id, 'confirmRecovery', 0, () => h.act('confirmRecovery', { ...pending, recoveryToken: file.recoveryToken, downloadConfirmed: true }));
    let ctx = sessionContext(owner);
    tick(); await expectBump(h, id, 'stepUp', 0, () => h.service.stepUp({ method: 'password', password: PASSWORD }, ctx));
    tick(); await expectBump(h, id, 'owner read (last-use write)', 0, () => h.owner(ctx));
    tick(); const second = await expectBump(h, id, 'loginPassword', 0, () => h.act('loginPassword', { handle: pending.account.handle, password: PASSWORD, turnstileToken: 'verified' }));
    const secondId = (await h.owner(sessionContext(second))).devices.find(d => d.current).id;
    await expectBump(h, id, 'renameSession', 0, () => h.act('renameSession', { sessionId: secondId, label: 'Laptop' }, ctx));
    await expectBump(h, id, 'acceptTerms (current)', 0, () => h.service.acceptTerms({ termsVersion: h.resources.config.termsVersion }, ctx));
    tick(); await expectBump(h, id, 'emailStart', 0, () => h.act('emailStart', { email: 'second@mail.example' }, ctx));
    await expectBump(h, id, 'emailConfirm (new address)', 1, () => h.act('emailConfirm', { token: mailToken(h, 'link'), confirmed: true }, ctx));
    tick(); await h.act('emailStart', { email: 'second@mail.example' }, ctx);
    await expectBump(h, id, 'emailConfirm (same address)', 0, () => h.act('emailConfirm', { token: mailToken(h, 'link'), confirmed: true }, ctx));
    tick(); await expectBump(h, id, 'configureEmailLogin enable', 1, () => h.act('configureEmailLogin', { enabled: true }, ctx));
    await expectBump(h, id, 'configureEmailLogin enable again', 0, () => h.act('configureEmailLogin', { enabled: true }, ctx));
    tick(); await expectBump(h, id, 'emailLoginStart', 0, () => h.act('emailLoginStart', { email: 'second@mail.example', turnstileToken: 'verified' }));
    await expectBump(h, id, 'emailLoginConfirm', 0, () => h.act('emailLoginConfirm', { token: mailToken(h, 'login'), confirmed: true }));
    await expectBump(h, id, 'configureEmailLogin disable', 0, () => h.act('configureEmailLogin', { enabled: false }, ctx));
    tick(); const { challengeId } = await expectBump(h, id, 'credentialBegin', 0, () => h.act('credentialBegin', { label: 'Key' }, ctx));
    await expectBump(h, id, 'credentialFinish', 1, () => h.act('credentialFinish', { challengeId, response: { id: 'cred-1' } }, ctx));
    await expectBump(h, id, 'renamePasskey', 0, () => h.act('renamePasskey', { credentialId: 'cred-1', label: 'Renamed' }, ctx));
    tick(); const { challengeToken } = await h.act('beginPasskeyLogin', { handle: pending.account.handle, turnstileToken: 'verified' });
    const third = await expectBump(h, id, 'finishPasskeyLogin (counter update)', 0, () => h.act('finishPasskeyLogin', { challengeToken, response: { id: 'cred-1' } }));
    tick(); await expectBump(h, id, 'removePasskey', 1, () => h.act('removePasskey', { credentialId: 'cred-1' }, ctx));
    assert.equal((await h.record(id)).sessions.some(s => s.credentialId === 'cred-1'), false, 'the passkey session ended with it');
    await expectBump(h, id, 'revokeOtherSessions', 0, () => h.act('revokeOtherSessions', {}, ctx));
    await expectBump(h, id, 'revokeSession', 0, async () => { const other = await h.act('loginPassword', { handle: pending.account.handle, password: PASSWORD, turnstileToken: 'verified' }); return h.act('revokeSession', { sessionId: (await h.owner(sessionContext(other))).devices.find(d => d.current).id }, ctx); });
    void third;
    tick(); await h.service.stepUp({ method: 'password', password: PASSWORD }, ctx);
    await expectBump(h, id, 'emailRemove', 1, () => h.service.emailRemove({ confirmed: true }, ctx));
    await expectBump(h, id, 'logout', 0, () => h.act('logout', {}, ctx));
    // Recovery: start and resume are recovery-file uses; replacement credentials and the new file bump; completion does not.
    tick(); const recovered = await expectBump(h, id, 'recover (start)', 1, () => h.act('recover', { recoveryToken: file.recoveryToken, turnstileToken: 'verified' }));
    tick(); const resumed = await expectBump(h, id, 'recover (resume)', 1, () => h.act('recover', { recoveryToken: file.recoveryToken, turnstileToken: 'verified' }));
    assert.equal(resumed.resumed, true); void recovered;
    tick(); await expectBump(h, id, 'setPendingPassword (recovery)', 1, () => h.act('setPendingPassword', { pendingToken: resumed.pendingToken, password: 'another long recovery password' }));
    tick(); const replacement = await expectBump(h, id, 'downloadRecovery (rotation)', 1, () => h.act('downloadRecovery', { pendingToken: resumed.pendingToken }));
    tick(); const back = await expectBump(h, id, 'confirmRecovery (recovery completion)', 0, () => h.act('confirmRecovery', { pendingToken: resumed.pendingToken, recoveryToken: replacement.recoveryToken, downloadConfirmed: true }));
    ctx = sessionContext(back); await expectBump(h, id, 'owner read', 0, () => h.owner(ctx));
    // Active-account reissue (recovery-identity spec): staging the new file is not a security change; its commit bumps once.
    await h.engine.container.use(['identity'], ({ identity }) => { identity.identityBackup = { reissue: async () => ({ backup: { keychain: { signing: { kid: 'k-reissued' }, encryption: { kid: 'e-1' } } }, rotation: { rotated: true } }), reissueCommit: async () => ({ committed: true, transferCancelled: false }) }; });
    { const a = await h.record(id); assert.equal(await h.audit.repository.compareAndSwap(id, a.revision, { ...structuredClone(a), passwordSetAt: h.clock.now() - 8 * 24 * HOUR, revision: a.revision + 1 }), true); }
    tick(); await h.service.stepUp({ method: 'password', password: 'another long recovery password' }, ctx);
    const staged = await expectBump(h, id, 'reissueRecoveryBegin', 0, () => h.act('reissueRecoveryBegin', { acknowledged: true }, ctx));
    tick(); await expectBump(h, id, 'reissueRecoveryConfirm', 1, () => h.act('reissueRecoveryConfirm', { recoveryToken: staged.recoveryToken, downloadConfirmed: true }, ctx));
    // A passkey signup bumps once more when its credential registers.
    const bob = await h.act('signup', signupInput({ handle: 'bob', method: 'passkey', password: undefined }));
    await expectBump(h, bob.account.id, 'registerPasskey', 1, () => h.act('registerPasskey', { pendingToken: bob.pendingToken, response: { id: 'bob-key' } }));
    assert.deepEqual(h.audit.violations, []);
    const counted = new Set(h.audit.writes.flatMap(w => w.events));
    for (const event of SECURITY_EVENTS) assert(counted.has(event), `tour covers ${event}`);
  });
}

test('R1-H1: an audit flood of 150 sign-ins, step-ups and sign-outs after an email change keeps the change visible', async t => {
  const h = harness(t, 'memory'), { id, handle, ctx } = await activeAccount(h);
  h.clock.advance(HOUR); await h.service.stepUp({ method: 'password', password: PASSWORD }, ctx); await linkEmail(h, ctx, 'flood@mail.example');
  const changed = await h.security(id);
  for (let i = 0; i < 50; i++) {
    h.clock.advance(MINUTE);
    const session = sessionContext(await h.act('loginPassword', { handle, password: PASSWORD, turnstileToken: 'verified' }));
    await h.service.stepUp({ method: 'password', password: PASSWORD }, session);
    await h.act('logout', {}, session);
  }
  const record = await h.record(id);
  assert.equal(record.audit.length, 100);
  assert.equal(record.audit.some(e => e.type === 'email-linked'), false, 'the change scrolled out of the security log');
  assert.deepEqual(await h.security(id), changed, 'security state still names the change');
  assert(h.clock.now() - changed.changedAt < 72 * HOUR, 'so a deletion request now still gets the 30-day grace');
  assert.deepEqual(h.audit.violations, []);
});

test('changedAt never moves backwards when the identity clock steps back', async t => {
  const clock = fakeClock(), h = harness(t, 'memory', { clock }), { id, handle, ctx } = await activeAccount(h);
  h.clock.advance(HOUR); await h.service.stepUp({ method: 'password', password: PASSWORD }, ctx); await linkEmail(h, ctx, 'a@mail.example'); const first = await h.security(id);
  h.clock.advance(-30 * MINUTE);
  const fresh = sessionContext(await h.act('loginPassword', { handle, password: PASSWORD, turnstileToken: 'verified' }));
  await h.act('configureEmailLogin', { enabled: true }, fresh);
  assert.deepEqual(await h.security(id), { epoch: first.epoch + 1, changedAt: first.changedAt });
  assert.deepEqual(h.audit.violations, []);
});

test('a lost CAS race never bumps, and the retried security change bumps exactly once', async t => {
  let interfere = false;
  const h = harness(t, 'memory', { wrap: repository => new Proxy(repository, { get(target, key) {
    const value = Reflect.get(target, key);
    // A concurrent unrelated writer (session last-use) commits between the service's read and its CAS.
    if (key === 'compareAndSwap') return async (id, revision, account) => { if (interfere) { interfere = false; const current = await target.get(id); current.lastActiveAt += 1; current.revision = revision + 1; assert(await value.call(target, id, revision, current)); } return value.call(target, id, revision, account); };
    return typeof value === 'function' ? value.bind(target) : value;
  } }) });
  const { id, ctx } = await activeAccount(h);
  await linkEmail(h, ctx, 'race@mail.example');
  const before = await h.security(id);
  interfere = true;
  await assert.rejects(h.act('configureEmailLogin', { enabled: true }, ctx), { code: 'conflict' });
  assert.deepEqual(await h.security(id), before, 'the losing write left no bump');
  assert.equal((await h.record(id)).emailLoginEnabled, false);
  await h.act('configureEmailLogin', { enabled: true }, ctx);
  assert.equal((await h.security(id)).epoch, before.epoch + 1);
  assert.deepEqual(h.audit.violations, []);
});

for (const kind of REPOSITORIES) {
  test(`${kind}: seeded chaos — concurrent security changes and session churn lose no bump and never double-bump`, async t => forEachSeed(kind === 'memory' ? 40 : 16, async random => {
    const scheduler = createScheduler(random), h = harness(t, kind, { wrap: repository => scheduler.wrap(repository, 'identity') });
    const { id, handle, ctx } = await activeAccount(h);
    await h.service.stepUp({ method: 'password', password: PASSWORD }, ctx);
    await h.act('emailStart', { email: 'next@mail.example' }, ctx); const token = mailToken(h, 'link');
    const { challengeId } = await h.act('credentialBegin', { label: 'Key' }, ctx);
    const initial = await h.security(id);
    const bumping = new Set([0, 1, 2]);
    const results = await scheduler.run([
      () => h.act('emailConfirm', { token, confirmed: true }, ctx),
      () => h.act('credentialFinish', { challengeId, response: { id: 'race-key' } }, ctx),
      () => h.act('configureEmailLogin', { enabled: true }, ctx).catch(error => { if (error.code === 'verified_email_required') return null; throw error; }),
      () => h.act('loginPassword', { handle, password: PASSWORD, turnstileToken: 'verified' }),
      () => h.service.stepUp({ method: 'password', password: PASSWORD }, ctx),
      () => h.owner(ctx),
    ]);
    for (const [i, r] of results.entries()) if (r.status === 'rejected') assert.equal(r.reason.code, 'conflict', `task ${i}: ${r.reason.stack}`);
    const record = await h.record(id), after = await h.security(id);
    let expected = 0;
    if (results[0].status === 'fulfilled') expected++;
    if (results[1].status === 'fulfilled') expected++;
    if (results[2].status === 'fulfilled' && results[2].value) expected++;
    void bumping;
    assert.equal(after.epoch, initial.epoch + expected, `epoch ${initial.epoch}→${after.epoch} for ${results.map(r => r.status).join(',')}\n${scheduler.trace.join('\n')}`);
    assert.equal(record.verifiedEmail === 'next@mail.example', results[0].status === 'fulfilled');
    assert.equal(record.credentials.some(c => c.id === 'race-key'), results[1].status === 'fulfilled');
    assert.equal(record.emailLoginEnabled === true, results[2].status === 'fulfilled' && Boolean(results[2].value));
    assert.deepEqual(h.audit.violations, []);
  }));
}
