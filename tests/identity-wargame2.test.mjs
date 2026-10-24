// Identity core regressions from the 2026-10-23 red-team review (wargame 2), engine level. Federation findings are in
// tests/federation-wargame2.test.mjs and the admin console / boot findings in tests/boot-admin.test.mjs.
//   #1  a stolen password must not become a permanent takeover through reissue + recover (cooling-off window)
//   #3  CAPTCHA-less traffic must not lock a handle out of sign-in
//   #7  email sign-in start: per-mailbox and global windows
//   #8  email sign-in start: no account-existence timing oracle
//   #9  passkey begin: opaque token, no state, no eviction; single-use finish
//   #11 pending password: budgeted before any KDF work
//   P15 churn: recovery downloads are budgeted
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { identityEngine, activate, signupInput, context, PASSWORD, fakeHasher, sessionContext } from './helpers/identity-engine.mjs';
import { reissueFixture, DAY, MINUTE } from './helpers/recovery-reissue.mjs';
import { limit } from '../packages/runtime/routes/shared.mjs';
import { federationEpoch } from '../packages/runtime/federation.mjs';
import { RECOVERY_REISSUE_WINDOW_MS } from '../packages/identity/service.mjs';
import { stages as reissuePages, REISSUE_CANCEL_PATH, reissueCancelScript } from '../packages/runtime/routes/recovery-reissue.mjs';

/** The production route limiter (`limit` over `abuseWindows`) on an in-memory window store with FixedWindowGuard
 * semantics, including `peek` (checks without counting). */
function realLimiter() {
  const windows = new Map(), env = { ABUSE_HASH_KEY: 'identity-wargame2-abuse-key-0000000', ABUSE: { consume: async (key, { windowMs, limit: max, peek = false }) => {
    const now = Date.now(); let w = windows.get(key); if (!w || w.end <= now) w = { n: 0, end: now + windowMs };
    if (w.n + 1 > max) return false; if (peek) return true; w.n++; windows.set(key, w); return true; } } };
  return { check: input => limit(env, input), windows };
}

// ---- #1 reissue takeover ---------------------------------------------------------------------------------------

test('#1(a): with a passkey enrolled, a password step-up (however old the password) never reissues the recovery file', async t => {
  const f = await reissueFixture(t);
  await f.patch(a => ({ ...a, passwordSetAt: f.now() - 60 * DAY, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, label: 'Owner phone', createdAt: f.now() - 30 * DAY }] }));
  const attacker = await f.secondSession(); await f.stepUp('password', attacker);
  await assert.rejects(f.begin({ acknowledged: true }, attacker), { code: 'reauthentication_required', message: /passkey/ });
  const record = await f.identity(); assert.equal(record.recoveryStaged, undefined); assert.equal(record.recoveryHash, (await f.identityBefore()).recoveryHash);
  await assert.doesNotReject(f.recover(f.file), 'the owner file still restores');
});

test('#1(b)-(d): a password-only reissue cannot recover for 7 days; the owner\'s file cannot recover either but cancels it, which restores the file, voids the new one, rotates its key and revokes grants', async t => {
  const f = await reissueFixture(t); await f.age();
  const e0 = await federationEpoch(await f.identity());
  // Attacker: a stuffed password only (no passkey on this account). Reissue and confirm.
  const attacker = await f.secondSession(); await f.stepUp('password', attacker);
  const staged = f.parse(await f.begin({ acknowledged: true }, attacker)); const done = await f.confirm(staged, {}, attacker);
  assert.equal(done.usableAt, f.now() + RECOVERY_REISSUE_WINDOW_MS);
  const e1 = await federationEpoch(await f.identity()); assert.notEqual(e1, e0);
  // (b) The minted file cannot start a recovery yet; (d) the owner's file cannot recover, only cancel.
  await assert.rejects(f.recover(staged), { code: 'recovery_not_ready' });
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_pending' });
  let record = await f.identity(); assert.equal(record.status, 'active'); assert.equal(record.sessions.length, 2, 'no session was wiped');
  // A forged or other file cannot cancel.
  await assert.rejects(f.service.reissueRecoveryCancelFile({ recoveryToken: staged.recoveryToken, identityBackup: staged.backup, turnstileToken: 'ok' }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' }), { code: 'recovery_reissue_not_pending' });
  const cancelled = await f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken, identityBackup: f.file.backup, turnstileToken: 'ok' }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' });
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.restored, true);
  record = await f.identity();
  assert.equal(record.recoveryHash, (await f.identityBefore()).recoveryHash, 'the previous credential is current again');
  assert.equal(record.recoveryPrevious, undefined);
  assert.equal(await f.keyState(staged.backup.keychain.signing.kid), 'retired', 'P15: the voided file no longer holds the current signing key');
  const e2 = await federationEpoch(record); assert.notEqual(e2, e0, 'restoring the credential never revives older grants'); assert.notEqual(e2, e1);
  assert.ok(f.mail.some(m => m.type === 'recovery-reissue-cancelled'));
  await assert.rejects(f.recover(staged), { code: 'unauthorized' }, 'the voided file never works');
  const recovered = await f.recover(f.file); assert.equal(recovered.resumed, false, 'the owner file has full authority again');
});

test('#1(c): cancel from a session that predates the reissue, or with the emailed link; a session created after it began cannot', async t => {
  const f = await reissueFixture(t); await f.age(); f.advance(MINUTE);
  const attacker = await f.secondSession(); await f.stepUp('password', attacker);
  const staged = f.parse(await f.begin({ acknowledged: true }, attacker));
  f.advance(MINUTE); const late = await f.secondSession();
  await f.confirm(staged, {}, attacker);
  assert.equal((await f.owner()).recovery.pendingReissue.cancellable, true);
  await assert.rejects(f.service.reissueRecoveryCancel({ confirmed: true }, late), { code: 'reissue_cancel_not_allowed' });
  await assert.rejects(f.service.reissueRecoveryCancel({}, f.ctx), { code: 'confirmation_required' });
  assert.equal((await f.service.reissueRecoveryCancel({ confirmed: true }, f.ctx)).cancelled, true);
  await assert.rejects(f.recover(staged), { code: 'unauthorized' });

  const g = await reissueFixture(t); await g.age();
  const thief = await g.secondSession(); await g.stepUp('password', thief);
  await g.confirm(g.parse(await g.begin({ acknowledged: true }, thief)), {}, thief);
  const notice = g.mail.find(m => m.type === 'recovery-reissued'); assert.ok(notice.cancelToken, 'the pre-existing email gets the cancel link');
  const base = { origin: g.ctx.origin, remoteIP: '127.0.0.1' };
  await assert.rejects(g.service.reissueRecoveryCancelEmail({ token: notice.cancelToken }, base), { code: 'confirmation_required' });
  await assert.rejects(g.service.reissueRecoveryCancelEmail({ token: `${g.id}.${'x'.repeat(43)}`, confirmed: true }, base), { code: 'recovery_reissue_not_pending' });
  assert.equal((await g.service.reissueRecoveryCancelEmail({ token: notice.cancelToken, confirmed: true }, base)).cancelled, true);
  await assert.rejects(g.service.reissueRecoveryCancelEmail({ token: notice.cancelToken, confirmed: true }, base), { code: 'recovery_reissue_not_pending' }, 'single use');
  await assert.doesNotReject(g.recover(g.file));

  // An email verified after the reissue began receives no cancel capability.
  const h = await reissueFixture(t); await h.age();
  const other = await h.secondSession(); await h.stepUp('password', other);
  const s = h.parse(await h.begin({ acknowledged: true }, other));
  await h.patch(a => ({ ...a, verifiedEmail: 'attacker@reissue.example', emailVerifiedAt: h.now() }));
  await h.confirm(s, {}, other);
  assert.equal(h.mail.find(m => m.type === 'recovery-reissued').cancelToken, undefined);
});

test('#1: after the window the new file recovers and the previous one is gone; a second reissue waits for the window', async t => {
  const f = await reissueFixture(t); await f.age(); await f.stepUp('password');
  const staged = f.parse(await f.begin()); await f.confirm(staged);
  await f.stepUp('password'); await assert.rejects(f.begin(), { code: 'recovery_reissue_pending' });
  f.advance(RECOVERY_REISSUE_WINDOW_MS);
  await assert.rejects(f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken, identityBackup: f.file.backup, turnstileToken: 'ok' }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' }), { code: 'recovery_reissue_not_pending' });
  await assert.rejects(f.recover(f.file), { code: 'unauthorized' });
  assert.equal((await f.recover(staged)).resumed, false);
});

test('#1(c): the emailed cancel page changes nothing on GET, keeps the capability out of the URL and has a strict policy', async () => {
  const env = {}, get = (path, query = '') => reissuePages.public({ request: new Request(`https://3sln.example${path}${query}`), env, path, url: new URL(`https://3sln.example${path}${query}`) });
  const page = await get(REISSUE_CANCEL_PATH); assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Security-Policy'), /script-src 'self';/); assert.equal(page.headers.get('Cache-Control'), 'no-store');
  const html = await page.text(); assert.match(html, /<button type="submit" disabled>/); assert.equal(/token/i.test(html), false);
  assert.equal((await get(REISSUE_CANCEL_PATH, '?token=x')).status, 400, 'no capability in the query string');
  const script = reissueCancelScript(); assert.match(script, /history\.replaceState/); assert.match(script, /\/api\/auth\/recovery\/reissue\/cancel-email/); assert.match(script, /confirmed:true/);
  assert.equal((await reissuePages.public({ request: new Request('https://3sln.example' + REISSUE_CANCEL_PATH, { method: 'POST' }), env, path: REISSUE_CANCEL_PATH, url: new URL('https://3sln.example' + REISSUE_CANCEL_PATH) })).status, 405);
});

// ---- #3 handle lockout -------------------------------------------------------------------------------------------

test('#3: CAPTCHA-less attempts never touch the handle window; only completed failed checks count, and they still cap guessing', async () => {
  let enforce = false, kdf = 0; const limiter = realLimiter();
  const passwordHasher = { ...fakeHasher, verify: async (value, encoded) => { kdf++; return fakeHasher.verify(value, encoded); } };
  const f = identityEngine({ passwordHasher, rateLimiter: { check: input => enforce ? limiter.check(input) : true } });
  await activate(f.act, signupInput({ handle: 'victim' })); enforce = true; kdf = 0;
  const ip = n => ({ ...context, remoteIP: `198.51.${100 + (n >> 8)}.${n & 255}` });
  for (let i = 0; i < 40; i++) await assert.rejects(f.act('loginPassword', { handle: 'victim', password: 'x'.repeat(20), turnstileToken: 'bogus' }, ip(i)), { code: 'challenge_failed' });
  for (let i = 0; i < 40; i++) await assert.rejects(f.act('beginPasskeyLogin', { handle: 'victim', turnstileToken: 'bogus' }, ip(100 + i)), { code: 'challenge_failed' });
  assert.equal(kdf, 0);
  // The owner's own successful sign-ins never consume it either.
  for (let i = 0; i < 25; i++) assert.ok((await f.act('loginPassword', { handle: 'victim', password: PASSWORD, turnstileToken: 'verified' }, ip(200 + i))).sessionToken);
  // Passkey begin is exempt from the handle window.
  for (let i = 0; i < 25; i++) assert.ok((await f.act('beginPasskeyLogin', { handle: 'victim', turnstileToken: 'verified' }, ip(300 + i))).challengeToken);
  // Solved CAPTCHAs with wrong passwords: 20 completed failures per 5 minutes, then refused before the KDF.
  kdf = 0; let refused = 0;
  for (let i = 0; i < 30; i++) await f.act('loginPassword', { handle: 'victim', password: 'y'.repeat(20), turnstileToken: 'verified' }, ip(400 + i)).catch(error => { if (error.code === 'rate_limited') refused++; else assert.equal(error.code, 'unauthorized'); });
  assert.equal(kdf, 20); assert.equal(refused, 10);
});

// ---- #7, #8 email sign-in start ----------------------------------------------------------------------------------

async function emailLogin(f) {
  const { ownerContext } = await activate(f.act);
  await f.act('emailStart', { email: 'victim@mail.example' }, ownerContext);
  await f.act('emailConfirm', { token: f.mail.at(-1).token, confirmed: true }, ownerContext);
  await f.act('configureEmailLogin', { enabled: true }, ownerContext);
  f.mail.length = 0; return ownerContext;
}

test('#7: email sign-in start has a per-mailbox window across many addresses, charged for unknown mailboxes too', async () => {
  const gate = { live: null, check: input => gate.live ? gate.live.check(input) : true }, f = identityEngine({ rateLimiter: gate });
  try {
    await emailLogin(f); gate.live = realLimiter();
    let refused = 0;
    for (let i = 0; i < 50; i++) await f.act('emailLoginStart', { email: 'victim@mail.example', turnstileToken: 'verified' }, { ...context, remoteIP: `203.0.113.${i}` }).catch(error => { assert.equal(error.code, 'rate_limited'); refused++; });
    await f.service.settleBackground();
    assert.equal(f.mail.length, 5); assert.equal(refused, 45);
    // An address without an account is limited identically, so the limit reveals nothing.
    refused = 0;
    for (let i = 0; i < 10; i++) await f.act('emailLoginStart', { email: 'nobody@mail.example', turnstileToken: 'verified' }, { ...context, remoteIP: `203.0.114.${i}` }).catch(() => { refused++; });
    assert.equal(refused, 5);
    // CAPTCHA-less starts never charge the mailbox.
    const fresh = identityEngine({ rateLimiter: realLimiter() });
    for (let i = 0; i < 20; i++) await assert.rejects(fresh.act('emailLoginStart', { email: 'other@mail.example', turnstileToken: 'bogus' }, { ...context, remoteIP: `203.0.115.${i}` }), { code: 'challenge_failed' });
    assert.deepEqual(await fresh.act('emailLoginStart', { email: 'other@mail.example', turnstileToken: 'verified' }, { ...context, remoteIP: '203.0.116.1' }), { sent: true });
  } finally { await f.engine.dispose(); }
});

test('#8: email sign-in start takes the same time and never surfaces provider errors, whether or not the address can sign in', async () => {
  const LATENCY = 150, sent = [];
  let failing = false;
  const f = identityEngine({ mailer: { sendVerification: async value => { sent.push(value); await new Promise(resolve => setTimeout(resolve, LATENCY)); if (failing && value.purpose === 'login') throw Object.assign(new Error('provider said: quota for victim@mail.example'), { code: 'E_DAILY_LIMIT_EXCEEDED' }); } } });
  try {
    const { ownerContext } = await activate(f.act);
    await f.act('emailStart', { email: 'victim@mail.example' }, ownerContext);
    await f.act('emailConfirm', { token: sent.at(-1).token, confirmed: true }, ownerContext);
    await f.act('configureEmailLogin', { enabled: true }, ownerContext);
    const time = async email => { const started = performance.now(); assert.deepEqual(await f.act('emailLoginStart', { email, turnstileToken: 'verified' }), { sent: true }); return performance.now() - started; };
    const known = [], unknown = [];
    for (let i = 0; i < 3; i++) { known.push(await time('victim@mail.example')); unknown.push(await time(`nobody${i}@mail.example`)); }
    const median = values => values.sort((a, b) => a - b)[1];
    assert.ok(median(known) < LATENCY / 2 && median(unknown) < LATENCY / 2, `known ${median(known).toFixed(1)} ms, unknown ${median(unknown).toFixed(1)} ms`);
    await f.service.settleBackground(); assert.equal(sent.filter(value => value.purpose === 'login').length, 3, 'the hits were still mailed');
    failing = true; assert.deepEqual(await f.act('emailLoginStart', { email: 'victim@mail.example', turnstileToken: 'verified' }), { sent: true });
    await f.service.settleBackground();
  } finally { await f.engine.dispose(); }
});

// ---- #9 passkey begin --------------------------------------------------------------------------------------------

function passkeyEngine() {
  let n = 0;
  const webauthn = { registrationOptions: async () => ({ challenge: 'unused' }), authenticationOptions: async () => ({ challenge: `challenge-${n++}-${randomUUID()}` }),
    verifyAuthentication: async ({ response, challenge }) => { if (response?.signed !== challenge) throw new Error('bad assertion'); return { counter: 0, backedUp: true }; } };
  return identityEngine({ webauthn });
}

test('#9: passkey begin is opaque and stateless: no account id, no existence or status signal, no write, no eviction', async () => {
  const f = passkeyEngine(), { owner } = await activate(f.act, signupInput({ handle: 'hidden' }));
  const record = f.repository.records.get(owner.account.id); record.credentials = [{ id: 'cred-1', publicKey: 'pk', counter: 0, createdAt: Date.now() }];
  const revision = record.revision;
  const mine = await f.act('beginPasskeyLogin', { handle: 'hidden', turnstileToken: 'verified' });
  assert.equal(mine.challengeToken.includes(owner.account.id), false, 'no account id in the token');
  // Many other callers begin for the same handle; nothing is stored, so nothing is evicted.
  for (let i = 0; i < 12; i++) await f.act('beginPasskeyLogin', { handle: 'hidden', turnstileToken: 'verified' }, { ...context, remoteIP: `198.51.100.${i}` });
  assert.equal(f.repository.records.get(owner.account.id).revision, revision, 'begin never writes the account');
  // Suspended and unknown handles get tokens of the same shape.
  f.repository.records.get(owner.account.id).status = 'suspended';
  const shape = token => token.replace(/[A-Za-z0-9_-]/g, 'x').length;
  const suspended = await f.act('beginPasskeyLogin', { handle: 'hidden', turnstileToken: 'verified' }), unknown = await f.act('beginPasskeyLogin', { handle: 'nobody', turnstileToken: 'verified' });
  assert.ok(Math.abs(shape(suspended.challengeToken) - shape(unknown.challengeToken)) <= 4);
  f.repository.records.get(owner.account.id).status = 'active';
  // Finish works for the first caller, once.
  const finish = () => f.act('finishPasskeyLogin', { challengeToken: mine.challengeToken, response: { id: 'cred-1', signed: mine.authenticationOptions.challenge } });
  assert.ok((await finish()).sessionToken);
  await assert.rejects(finish(), { code: 'unauthorized' }, 'single use');
  // A token for another handle, a tampered token or an expired one never authenticates.
  const other = await f.act('beginPasskeyLogin', { handle: 'nobody', turnstileToken: 'verified' });
  await assert.rejects(f.act('finishPasskeyLogin', { challengeToken: other.challengeToken, response: { id: 'cred-1', signed: other.authenticationOptions.challenge } }), { code: 'unauthorized' });
  const fresh = await f.act('beginPasskeyLogin', { handle: 'hidden', turnstileToken: 'verified' }), [, payload] = fresh.challengeToken.split('.');
  const forged = JSON.parse(Buffer.from(payload, 'base64url')); forged.c = 'attacker-challenge';
  await assert.rejects(f.act('finishPasskeyLogin', { challengeToken: `pl1.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${fresh.challengeToken.split('.')[2]}`, response: { id: 'cred-1', signed: 'attacker-challenge' } }), { code: 'unauthorized' });
  f.clock.advance(300001);
  await assert.rejects(f.act('finishPasskeyLogin', { challengeToken: fresh.challengeToken, response: { id: 'cred-1', signed: fresh.authenticationOptions.challenge } }), { code: 'unauthorized' }, 'expired');
});

// ---- #11 pending password and P15 churn -------------------------------------------------------------------------

test('#11: pending password sets are budgeted before any KDF work: limiter first, then at most 5 per setup token, with no redundant verify', async () => {
  let kdf = 0, open = true;
  const passwordHasher = { dummyHash: fakeHasher.dummyHash, hash: async value => { kdf++; return fakeHasher.hash(value); }, verify: async (value, encoded) => { kdf++; return fakeHasher.verify(value, encoded); } };
  const f = identityEngine({ passwordHasher, rateLimiter: { check: async () => open } });
  const pending = await f.act('signup', signupInput({ handle: 'kdfburn', method: 'passkey', password: undefined }));
  open = false; kdf = 0;
  for (let i = 0; i < 10; i++) await assert.rejects(f.act('setPendingPassword', { pendingToken: pending.pendingToken, password: `burn-password-${i}-xxxxxxxx` }), { code: 'rate_limited' });
  assert.equal(kdf, 0, 'no KDF while limited');
  open = true;
  for (let i = 0; i < 5; i++) await f.act('setPendingPassword', { pendingToken: pending.pendingToken, password: `owner-password-${i}-xxxxxxxx` });
  assert.equal(kdf, 5, 'one hash per set; the immediate re-verify is gone');
  await assert.rejects(f.act('setPendingPassword', { pendingToken: pending.pendingToken, password: 'one-more-password-xxxxxxxx' }), { code: 'rate_limited' });
  assert.equal(kdf, 5);
});

test('P15 churn: recovery downloads are budgeted per setup token and by the limiter, so rotation cannot be churned', async () => {
  let open = true; const f = identityEngine({ rateLimiter: { check: async () => open } });
  const pending = await f.act('signup', signupInput({ handle: 'churn' }));
  for (let i = 0; i < 5; i++) await f.act('downloadRecovery', pending);
  await assert.rejects(f.act('downloadRecovery', pending), { code: 'rate_limited' });
  const other = await f.act('signup', signupInput({ handle: 'churn2' })); open = false;
  await assert.rejects(f.act('downloadRecovery', other), { code: 'rate_limited' });
  open = true; const file = await f.act('downloadRecovery', other);
  assert.ok((await f.act('confirmRecovery', { ...other, recoveryToken: file.recoveryToken, downloadConfirmed: true })).sessionToken);
});

test('the session context for sign-in still works end to end after the guard reorder (password, passkey begin)', async () => {
  const gate = { live: null, check: input => gate.live ? gate.live.check(input) : true }, f = identityEngine({ rateLimiter: gate }), { owner } = await activate(f.act); gate.live = realLimiter();
  assert.ok((await f.act('loginPassword', { handle: owner.account.handle, password: PASSWORD, turnstileToken: 'verified' })).sessionToken);
  assert.ok((await f.owner(sessionContext(owner))).account);
});

test('#1(c) over HTTP: the cancel page is served by the router and the emailed link cancels through the real route', async t => {
  const f = await reissueFixture(t); await f.age(); f.advance(MINUTE);
  const attacker = await f.secondSession(); await f.stepUp('password', attacker);
  await f.confirm(f.parse(await f.begin({ acknowledged: true }, attacker)), {}, attacker);
  const origin = f.ctx.origin, page = await f.app.fetch(new Request(origin + REISSUE_CANCEL_PATH));
  assert.equal(page.status, 200); assert.match(page.headers.get('Content-Type'), /text\/html/);
  const script = await f.app.fetch(new Request(origin + REISSUE_CANCEL_PATH + '.mjs')); assert.equal(script.status, 200); assert.match(script.headers.get('Content-Type'), /javascript/);
  const post = (path, body, headers = { Origin: origin }) => f.app.fetch(new Request(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  const token = f.mail.find(m => m.type === 'recovery-reissued').cancelToken;
  assert.equal((await post('/api/auth/recovery/reissue/cancel-email', { token, confirmed: true }, { Origin: 'https://evil.example' })).status, 403, 'cross-origin POST refused');
  const response = await post('/api/auth/recovery/reissue/cancel-email', { token, confirmed: true });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { cancelled: true, restored: true });
  const again = await post('/api/auth/recovery/reissue/cancel-email', { token, confirmed: true });
  assert.equal(again.status, 409); assert.equal((await again.json()).error, 'recovery_reissue_not_pending');
  await assert.doesNotReject(f.recover(f.file));
});

// ---- coordinator decision 2026-10-23: passkey-authorized reissues are not file-cancellable; swapped emails ----------

async function passkeyStepUp(f, context) {
  f.service.webauthn = { authenticationOptions: async () => ({ challenge: 'step-up-challenge' }), verifyAuthentication: async ({ response, challenge }) => { if (response?.id !== 'owner-passkey' || challenge !== 'step-up-challenge') throw new Error('bad'); return { counter: 1, backedUp: true }; } };
  await f.service.stepUpBegin({}, context);
  return f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, context);
}

test('#1 passkey branch: a passkey-authorized reissue cannot be cancelled (or recovered) with the previous file; earlier sessions and the pre-reissue email still cancel', async t => {
  const f = await reissueFixture(t);
  await f.patch(a => ({ ...a, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, label: 'Phone', createdAt: f.now() - 30 * DAY }] }));
  f.advance(MINUTE); const device = await f.secondSession(); await passkeyStepUp(f, device);
  const staged = f.parse(await f.begin({ acknowledged: true }, device)); await f.confirm(staged, {}, device);
  assert.equal((await f.identity()).recoveryPrevious.credential.kind, 'passkey');
  // The previous file (perhaps the leaked one this reissue retires) can neither recover nor cancel.
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_locked' });
  await assert.rejects(f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken, identityBackup: f.file.backup }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' }), { code: 'reissue_cancel_not_allowed' });
  assert.equal((await f.owner()).recovery.pendingReissue.previousFileCanCancel, false);
  // An earlier session can.
  assert.equal((await f.service.reissueRecoveryCancel({ confirmed: true }, f.ctx)).cancelled, true);
  await assert.doesNotReject(f.recover(f.file));

  const g = await reissueFixture(t);
  await g.patch(a => ({ ...a, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, label: 'Phone', createdAt: g.now() - 30 * DAY }] }));
  await passkeyStepUp(g, g.ctx); await g.confirm(g.parse(await g.begin()));
  const token = g.mail.find(m => m.type === 'recovery-reissued').cancelToken;
  assert.equal((await g.service.reissueRecoveryCancelEmail({ token, confirmed: true }, { origin: g.ctx.origin, remoteIP: '127.0.0.1' })).cancelled, true, 'the pre-reissue email still cancels');
});

test('#1 password branch: on an account without a passkey the previous file still cancels (a password thief cannot lock the owner out)', async t => {
  const f = await reissueFixture(t); await f.age();
  const thief = await f.secondSession(); await f.stepUp('password', thief);
  await f.confirm(f.parse(await f.begin({ acknowledged: true }, thief)), {}, thief);
  assert.equal((await f.identity()).recoveryPrevious.credential.kind, 'password');
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_pending' });
  assert.equal((await f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken, identityBackup: f.file.backup }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' })).cancelled, true);
});

test('#1 swapped email: an email replaced within 30 days before the reissue still gets the notices and the cancel link; older replacements do not', async t => {
  const f = await reissueFixture(t), sent = []; f.service.mailer.sendVerification = async value => { sent.push(value); };
  const owner = 'owner@reissue.example';
  // A password thief swaps the email (needs only a recent sign-in), then reissues.
  const thief = await f.secondSession();
  await f.service.emailStart({ email: 'thief@mail.example' }, thief); await f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, thief);
  assert.equal((await f.identity()).verifiedEmail, 'thief@mail.example');
  f.advance(MINUTE); await f.age(); await f.stepUp('password', thief);
  await f.confirm(f.parse(await f.begin({ acknowledged: true }, thief)), {}, thief);
  assert.ok(f.mail.some(m => m.email === owner && m.type === 'recovery-reissue-started'), 'the replaced email hears about the begin');
  const notice = f.mail.find(m => m.email === owner && m.type === 'recovery-reissued'); assert.ok(notice?.cancelToken, 'and gets the cancel link');
  assert.equal((await f.service.reissueRecoveryCancelEmail({ token: notice.cancelToken, confirmed: true }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' })).cancelled, true);
  assert.ok(f.mail.some(m => m.email === owner && m.type === 'recovery-reissue-cancelled'));

  // A replacement more than 30 days before the reissue is no longer a channel (review 2026-10-23 R1(iii)).
  const g = await reissueFixture(t), mails = []; g.service.mailer.sendVerification = async value => { mails.push(value); };
  const early = await g.secondSession();
  await g.service.emailStart({ email: 'new@mail.example' }, early); await g.service.emailConfirm({ token: mails.at(-1).token, confirmed: true }, early);
  g.advance(31 * DAY); await g.age(); const later = await g.secondSession(); await g.stepUp('password', later);
  await g.confirm(g.parse(await g.begin({ acknowledged: true }, later)), {}, later);
  assert.equal(g.mail.some(m => m.email === owner && m.type.startsWith('recovery-reissue')), false);
  assert.equal(g.mail.some(m => m.email === owner && m.type === 'recovery-reissued'), false);
  assert.ok(g.mail.find(m => m.email === 'new@mail.example' && m.type === 'recovery-reissued').cancelToken);
});

// ---- independent review 2026-10-23: R1, R2, notices, cancel effects -------------------------------------------------

function thiefWebauthn(f) {
  f.service.webauthn = { registrationOptions: async () => ({ challenge: 'reg' }), verifyRegistration: async () => ({ id: 'thief-passkey', publicKey: 'pk', counter: 0 }),
    authenticationOptions: async () => ({ challenge: 'auth' }), verifyAuthentication: async ({ response }) => { if (!['thief-passkey', 'owner-passkey'].includes(response?.id)) throw new Error('bad'); return { counter: 1, backedUp: false }; } };
}

test('R1: a password thief who enrols a passkey, swaps the email and revokes sessions still cannot lock the owner out: the reissue is not file-proof and every change was notified', async t => {
  const f = await reissueFixture(t), sent = []; f.service.mailer.sendVerification = async value => { sent.push(value); }; thiefWebauthn(f);
  const owner = 'owner@reissue.example', base = { origin: f.ctx.origin, remoteIP: '127.0.0.1' };
  const thief = await f.secondSession();
  await f.service.emailStart({ email: 'thief@mail.example' }, thief); await f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, thief);
  const { challengeId } = await f.service.credentialBegin({ label: 'x' }, thief); await f.service.credentialFinish({ challengeId, response: { id: 'thief-passkey' } }, thief);
  // (ii) Both changes reached the owner's (replaced) address and push, with guidance.
  assert.ok(f.mail.some(m => m.email === owner && m.type === 'email-changed')); assert.ok(f.mail.some(m => m.email === owner && m.type === 'passkey-added'));
  assert.ok(f.push.some(p => p.event === 'email-changed') && f.push.some(p => p.event === 'passkey-added'));
  f.advance(8 * DAY);
  const thief2 = await f.secondSession(), stale = await f.secondSession(); await f.service.revokeOtherSessions({}, thief2);
  assert.ok(f.mail.some(m => m.email === owner && m.type === 'sessions-revoked'), '(ii, iii) the replaced address is still a channel after 8 days');
  await f.service.stepUpBegin({}, thief2); await f.service.stepUp({ method: 'passkey', response: { id: 'thief-passkey' } }, thief2);
  const staged = f.parse(await f.begin({ acknowledged: true }, thief2)); await f.confirm(staged, {}, thief2);
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, false, '(i) a passkey enrolled after the file is not file-proof');
  assert.ok(f.mail.find(m => m.email === owner && m.type === 'recovery-reissued').cancelToken, 'password branch: the replaced address gets the link');
  await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_pending' });
  assert.equal((await f.service.reissueRecoveryCancelFile({ recoveryToken: f.file.recoveryToken, identityBackup: f.file.backup }, base)).cancelled, true);
  const record = await f.identity();
  assert.equal(record.sessions.length, 0, 'the thief session (created at the begin) ended with the cancel');
  assert.equal((await f.recover(f.file)).resumed, false);
});

test('R1(i)/V1: file-proof only for a passkey enrolled before the previous file, with no channel-removing event at all in the 30 days before the begin', async t => {
  const cases = [['proof', -40, [], true], ['passkey newer than the file', -10, [], false], ['email change before the passkey', -22, [{ kind: 'email-changed', at: -25 }], false],
    ['revocation before the passkey', -22, [{ kind: 'sessions-revoked', at: -24 }], false], ['event older than 30 days', -22, [{ kind: 'email-changed', at: -31 }], true], ['event after the passkey (V1: order no longer matters)', -40, [{ kind: 'email-changed', at: -1 }], false],
    ['session-cap eviction', -40, [{ kind: 'sessions-evicted', at: -2 }], false], ['passkey removal', -40, [{ kind: 'passkey-removed', at: -3 }], false]];
  for (const [name, passkeyAt, events, proof] of cases) {
    const f = await reissueFixture(t); thiefWebauthn(f);
    await f.patch(a => ({ ...a, recoveryIssuedAt: f.now() - 20 * DAY, authorityEvents: events.map(e => ({ kind: e.kind, at: f.now() + e.at * DAY })), credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() + passkeyAt * DAY }] }));
    await f.service.stepUpBegin({}, f.ctx); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, f.ctx);
    if (passkeyAt > -7) { await assert.rejects(f.begin(), { code: 'credential_too_new' }); await f.patch(a => ({ ...a, credentials: [{ ...a.credentials[0], createdAt: f.now() - 8 * DAY }], recoveryIssuedAt: f.now() - 7 * DAY })); await f.service.stepUpBegin({}, f.ctx); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, f.ctx); }
    await f.confirm(f.parse(await f.begin()));
    assert.equal((await f.identity()).recoveryPrevious.fileLocked, proof, name);
  }
});

test('R2: the file-proof distribution rule: a replaced address gets the notice only and the current email gets the link (white-box: under V1 a replacement inside the lookback is itself an event, so this branch needs patched state)', async t => {
  const f = await reissueFixture(t); thiefWebauthn(f);
  // White-box: a retained replacement without its authority event (state the service itself never produces under V1).
  await f.patch(a => ({ ...a, verifiedEmail: 'fresh@owner.example', emailVerifiedAt: f.now() - 31 * DAY, previousEmails: [{ email: 'owner@reissue.example', verifiedAt: f.now() - 60 * DAY, replacedAt: f.now() - 10 * DAY }], authorityEvents: [], credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() - 40 * DAY }], recoveryIssuedAt: f.now() - 35 * DAY }));
  await f.service.stepUpBegin({}, f.ctx); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, f.ctx);
  await f.confirm(f.parse(await f.begin()));
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, true);
  const replaced = f.mail.find(m => m.email === 'owner@reissue.example' && m.type === 'recovery-reissued'), current = f.mail.find(m => m.email === 'fresh@owner.example' && m.type === 'recovery-reissued');
  assert.ok(replaced, 'the replaced address is notified'); assert.equal(replaced.cancelToken, undefined, 'but gets no cancel capability');
  assert.ok(current.cancelToken); await assert.rejects(f.recover(f.file), { code: 'recovery_reissue_locked' });
});

test('V1 trade-off: an owner who swaps the email and then reissues with an old passkey is not file-proof, so the replaced address gets the cancel link', async t => {
  const f = await reissueFixture(t), sent = []; f.service.mailer.sendVerification = async value => { sent.push(value); }; thiefWebauthn(f);
  await f.patch(a => ({ ...a, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() - 30 * DAY }] }));
  await f.service.emailStart({ email: 'fresh@owner.example' }, f.ctx); await f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, f.ctx);
  f.advance(MINUTE); await f.service.stepUpBegin({}, f.ctx); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, f.ctx);
  await f.confirm(f.parse(await f.begin()));
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, false);
  assert.ok(f.mail.find(m => m.email === 'owner@reissue.example' && m.type === 'recovery-reissued').cancelToken);
});

test('cancel ends sessions created at or after the begin, and severs app connections; a recovery start severs them too', async t => {
  const f = await reissueFixture(t), severed = []; f.service.severConnections = async (owner, input) => { severed.push([owner, input]); };
  await f.age(); f.advance(MINUTE);
  const minter = await f.secondSession(); await f.stepUp('password', minter); f.advance(MINUTE);
  const staged = f.parse(await f.begin({ acknowledged: true }, minter)); const atBegin = await f.secondSession(); f.advance(MINUTE); const later = await f.secondSession();
  await f.confirm(staged, {}, minter);
  await f.service.reissueRecoveryCancel({ confirmed: true }, f.ctx);
  await assert.rejects(f.owner(later), { code: 'unauthorized' }); await assert.rejects(f.owner(atBegin), { code: 'unauthorized' }, 'at the begin counts'); await assert.doesNotReject(f.owner(f.ctx)); await assert.rejects(f.owner(minter), { code: 'unauthorized' }, 'the staging and confirming session ends even though it predates the begin');
  assert.deepEqual(severed, [[f.id, { reason: 'recovery' }]]);
  await f.recover(f.file); assert.deepEqual(severed.at(-1), [f.id, { reason: 'recovery' }]); assert.equal(severed.length, 2);
});

test('item 7: a cancel whose identity write never lands leaves the current (new) file restorable', async t => {
  const f = await reissueFixture(t); await f.age(); f.advance(MINUTE); await f.stepUp('password');
  const staged = f.parse(await f.begin()); await f.confirm(staged);
  const swap = f.service.repository.compareAndSwap; f.service.repository = new Proxy(f.service.repository, { get: (o, n) => n === 'compareAndSwap' ? async () => false : Reflect.get(o, n).bind?.(o) ?? Reflect.get(o, n) }); void swap;
  await assert.rejects(f.service.reissueRecoveryCancel({ confirmed: true }, f.ctx), { code: 'conflict' });
  assert.equal(await f.c.recoveryKeysMatch(f.id, staged.backup.keychain), true, 'the voided-to-be kid stays bound after the rotation');
});

test('item 8: a configured identity token key that is too short fails loudly instead of using a per-instance key', async () => {
  const f = identityEngine({ config: { ...(await import('./helpers/identity-engine.mjs')).config, linkedCodeKey: 'short' } });
  await assert.rejects(f.act('beginPasskeyLogin', { handle: 'alice', turnstileToken: 'verified' }), /at least 16/);
});

test('R1(ii): a password set during a recovery is notified to every email channel, with guidance', async t => {
  const f = await reissueFixture(t), started = await f.recover(f.file);
  await f.service.setPendingPassword({ pendingToken: started.pendingToken, password: 'a brand new recovery password' }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' });
  assert.ok(f.mail.some(m => m.email === 'owner@reissue.example' && m.type === 'password-changed'));
  assert.ok(f.push.some(p => p.event === 'password-changed'));
});

test('item 5: email sign-in windows: 5 per 15 minutes and 12 per 6 hours per mailbox, 5,000 per hour per region, 20,000 per hour overall', async () => {
  const { abuseWindows } = await import('../packages/core/abuse-policy.mjs');
  const windows = abuseWindows({ operation: 'email-login', phase: 'mailbox', ipHash: 'ip', subnetHash: 'net', handleHash: 'mbox', regionHash: 'reg' });
  assert.deepEqual(windows.map(w => [w.key, w.windowMs, w.limit]), [['email-login:mailbox:mbox', 900000, 5], ['email-login:mailbox-6h:mbox', 21600000, 12], ['email-login:region:reg', 3600000, 5000], ['email-login:global', 3600000, 20000]]);
  assert.equal(windows.some(w => w.windowMs >= 86400000), false, 'no mailbox is refused for a whole day');
});

// ---- re-verification 2026-10-23: V1 and follow-ups ---------------------------------------------------------------

test('V1: a pre-file rogue passkey, session-cap eviction and an email swap no longer make a file-proof reissue; eviction is notified', async t => {
  const f = await reissueFixture(t), sent = []; f.service.mailer.sendVerification = async v => { sent.push(v); }; thiefWebauthn(f);
  await f.patch(a => ({ ...a, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() - 60 * DAY }] }));
  const t0 = await f.secondSession(); const { challengeId } = await f.service.credentialBegin({ label: 'Laptop' }, t0); await f.service.credentialFinish({ challengeId, response: { id: 'thief-passkey' } }, t0);
  f.advance(10 * DAY);
  const owner10 = await f.secondSession(); await f.service.stepUpBegin({}, owner10); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, owner10);
  const ownerStaged = f.parse(await f.begin(undefined, owner10)); await f.confirm(ownerStaged, {}, owner10);
  const ownerFile = { recoveryToken: ownerStaged.recoveryToken, backup: ownerStaged.backup };
  f.advance(7 * DAY + MINUTE); await f.secondSession(); f.advance(MINUTE);
  const mark = f.mail.length; let thief; for (let i = 0; i < 10; i++) thief = await f.secondSession();
  assert.ok(f.mail.slice(mark).some(m => m.type === 'sessions-evicted'), 'eviction notified'); assert.ok((await f.identity()).authorityEvents.some(e => e.kind === 'sessions-evicted'));
  await f.service.emailStart({ email: 'thief@mail.example' }, thief); await f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, thief);
  await f.service.stepUpBegin({}, thief); await f.service.stepUp({ method: 'passkey', response: { id: 'thief-passkey' } }, thief);
  const staged = f.parse(await f.begin({ acknowledged: true }, thief)); await f.confirm(staged, {}, thief);
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, false);
  assert.ok(f.mail.slice(mark).some(m => m.email === 'owner@reissue.example' && m.cancelToken));
  assert.equal((await f.service.reissueRecoveryCancelFile({ recoveryToken: ownerFile.recoveryToken, identityBackup: ownerFile.backup }, { origin: f.ctx.origin, remoteIP: '127.0.0.1' })).cancelled, true);
});

test('V1 boundary: an event inside the lookback at the begin still counts at a confirm after it aged out; right after the lookback both the event and the replaced address are gone', async t => {
  for (const [offset, proof] of [[-(30 * DAY - MINUTE), false], [-(30 * DAY + MINUTE), true]]) {
    const f = await reissueFixture(t); thiefWebauthn(f);
    await f.patch(a => ({ ...a, recoveryIssuedAt: f.now() - 45 * DAY, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() - 50 * DAY }], authorityEvents: [{ kind: 'email-changed', at: f.now() + offset }], previousEmails: [{ email: 'old@reissue.example', verifiedAt: f.now() - 60 * DAY, replacedAt: f.now() + offset }] }));
    await f.service.stepUpBegin({}, f.ctx); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, f.ctx);
    const staged = f.parse(await f.begin()); f.advance(20 * MINUTE); await f.confirm(staged);
    assert.equal((await f.identity()).recoveryPrevious.fileLocked, proof, String(offset));
    const old = f.mail.find(m => m.email === 'old@reissue.example' && m.type === 'recovery-reissued');
    if (proof) assert.equal(old?.cancelToken, undefined); else assert.ok(old?.cancelToken, 'the replaced address is still a channel for this reissue');
  }
});

test('passkey removal records an authority event and notifies; credential begin is rate limited', async t => {
  let open = true; const f = await reissueFixture(t); f.service.rateLimiter = { check: async input => input.operation !== 'credential-begin' || open };
  f.service.webauthn = { registrationOptions: async () => ({ challenge: 'r' }) };
  await f.patch(a => ({ ...a, credentials: [{ id: 'a', publicKey: 'pk', counter: 0, createdAt: f.now() - DAY }, { id: 'b', publicKey: 'pk', counter: 0, createdAt: f.now() - DAY }] }));
  await f.service.removePasskey({ credentialId: 'b' }, f.ctx);
  assert.ok((await f.identity()).authorityEvents.some(e => e.kind === 'passkey-removed')); assert.ok(f.mail.some(m => m.type === 'passkey-removed'));
  open = false; await assert.rejects(f.service.credentialBegin({ label: 'x' }, f.ctx), { code: 'rate_limited' });
});

test('security notices coalesce per type: one per 10 minutes, the next carrying the count', async t => {
  const f = await reissueFixture(t); f.service.webauthn = { registrationOptions: async () => ({ challenge: 'r' }), verifyRegistration: async ({ response }) => ({ id: response.id, publicKey: 'pk', counter: 0 }) };
  const add = async id => { const { challengeId } = await f.service.credentialBegin({ label: id }, f.ctx); await f.service.credentialFinish({ challengeId, response: { id } }, f.ctx); };
  await add('k1'); await add('k2'); await add('k3');
  assert.equal(f.mail.filter(m => m.type === 'passkey-added').length, 1);
  f.advance(10 * 60000); await add('k4');
  // The window's pending count goes out as a trailing notice at the next write (the k4 begin), which restarts the
  // window, so k4 (same session) is pending until the next write or owner view after it.
  let sent = f.mail.filter(m => m.type === 'passkey-added'); assert.equal(sent.length, 2); assert.deepEqual([sent[1].count, sent[1].trailing], [2, true]);
  f.advance(10 * 60000); await f.owner(f.ctx);
  sent = f.mail.filter(m => m.type === 'passkey-added'); assert.equal(sent.length, 3); assert.deepEqual([sent[2].count, sent[2].trailing], [1, true]);
});

test('N1: a different session is never coalesced, and a pending count is delivered at the next owner view after the window', async t => {
  const f = await reissueFixture(t); let id = 'owner-new';
  f.service.webauthn = { registrationOptions: async () => ({ challenge: 'r' }), verifyRegistration: async () => ({ id, publicKey: 'pk', counter: 0 }) };
  const add = async ctx => { const { challengeId } = await f.service.credentialBegin({ label: 'x' }, ctx); await f.service.credentialFinish({ challengeId, response: {} }, ctx); };
  await add(f.ctx);
  const thief = await f.secondSession(); f.advance(MINUTE); id = 'thief-passkey'; await add(thief);
  assert.equal(f.mail.filter(m => m.type === 'passkey-added').length, 2, 'the second session is notified at once');
  // Same session twice: the repeat is pending, then delivered by the owner view once the window passed.
  id = 'thief-2'; f.advance(MINUTE); await add(thief);
  assert.equal(f.mail.filter(m => m.type === 'passkey-added').length, 2);
  f.advance(10 * MINUTE + 1); await f.owner(f.ctx);
  const trailing = f.mail.filter(m => m.type === 'passkey-added').at(-1); assert.deepEqual([trailing.count, trailing.trailing], [1, true]);
});

test('V2: filler events cannot push a channel removal out; the file-proof check reads the uncapped latest removal time', async t => {
  const f = await reissueFixture(t); thiefWebauthn(f);
  await f.patch(a => ({ ...a, recoveryIssuedAt: f.now() - 45 * DAY, credentials: [{ id: 'owner-passkey', publicKey: 'pk', counter: 0, createdAt: f.now() - 50 * DAY }] }));
  // 20 cheap events (own throwaway sessions revoked), then the one that matters.
  for (let i = 0; i < 20; i++) { const a = await f.secondSession(), b = await f.secondSession(); await f.service.revokeSession({ sessionId: b.sessionId }, a); }
  f.advance(29 * DAY); const late = await f.secondSession(), other = await f.secondSession(); await f.service.revokeSession({ sessionId: other.sessionId }, late);
  const record = await f.identity();
  assert.equal(record.authorityEvents.length, 16); assert.equal(record.authorityEvents.at(-1).at, f.now(), 'the display list keeps the newest');
  assert.equal(record.lastChannelRemovalAt, f.now());
  f.advance(2 * DAY); // the 20 fillers left the lookback; the late removal did not
  const now = await f.secondSession(); await f.service.stepUpBegin({}, now); await f.service.stepUp({ method: 'passkey', response: { id: 'owner-passkey' } }, now);
  await f.confirm(f.parse(await f.begin(undefined, now)), {}, now);
  assert.equal((await f.identity()).recoveryPrevious.fileLocked, false);
});

test('V2 audit: replaced emails are never dropped to make room (further changes are refused), and live sign-in nonces are never evicted', async t => {
  const f = await reissueFixture(t), sent = []; f.service.mailer.sendVerification = async v => { sent.push(v); };
  for (let i = 0; i < 8; i++) { await f.service.emailStart({ email: `e${i}@mail.example` }, f.ctx); await f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, f.ctx); }
  await f.service.emailStart({ email: 'e9@mail.example' }, f.ctx);
  await assert.rejects(f.service.emailConfirm({ token: sent.at(-1).token, confirmed: true }, f.ctx), { code: 'email_change_limited' });
  assert.ok((await f.identity()).previousEmails.some(e => e.email === 'owner@reissue.example'), 'the owner address is still a channel');
  const g = passkeyEngine(), { owner } = await activate(g.act, signupInput({ handle: 'nonces' }));
  g.repository.records.get(owner.account.id).credentials = [{ id: 'cred-1', publicKey: 'pk', counter: 0, createdAt: Date.now() }];
  for (let i = 0; i < 32; i++) { const b = await g.act('beginPasskeyLogin', { handle: 'nonces', turnstileToken: 'verified' }); await g.act('finishPasskeyLogin', { challengeToken: b.challengeToken, response: { id: 'cred-1', signed: b.authenticationOptions.challenge } }); }
  const b = await g.act('beginPasskeyLogin', { handle: 'nonces', turnstileToken: 'verified' });
  await assert.rejects(g.act('finishPasskeyLogin', { challengeToken: b.challengeToken, response: { id: 'cred-1', signed: b.authenticationOptions.challenge } }), { code: 'rate_limited' });
});

test('flushSever clears only the row it ran: a newer row written meanwhile survives for its own run', async t => {
  const f = await reissueFixture(t); let n = 0;
  f.service.severConnections = async () => { if (n++ === 0) { const a = await f.repository.get(f.id); await f.repository.compareAndSwap(f.id, a.revision, { ...a, pendingSever: { reason: 'recovery', at: a.pendingSever.at + 1 }, revision: a.revision + 1 }); } };
  await f.patch(a => ({ ...a, pendingSever: { reason: 'recovery', at: f.now() } }));
  await f.service.flushSever(f.id);
  assert.equal(n, 2, 'the newer row was run as well'); assert.equal((await f.identity()).pendingSever, undefined);
});

test('severing: a durable row written in the commit retries a failed port at the next owner read and at activation', async t => {
  const f = await reissueFixture(t); let fail = true; const calls = [];
  f.service.severConnections = async (owner, input) => { calls.push(input); if (fail) throw new Error('transient'); };
  await f.age(); f.advance(MINUTE); const minter = await f.secondSession(); await f.stepUp('password', minter); f.advance(MINUTE);
  await f.confirm(f.parse(await f.begin({ acknowledged: true }, minter)), {}, minter);
  await f.service.reissueRecoveryCancel({ confirmed: true }, f.ctx);
  assert.deepEqual((await f.identity()).pendingSever?.reason, 'recovery', 'the failed sever stays durable');
  fail = false; await f.owner(f.ctx);
  assert.equal((await f.identity()).pendingSever, undefined); assert.equal(calls.length, 2);
  fail = true; await f.recover(f.file); assert.ok((await f.identity()).pendingSever);
});

test('item 7 (info): with no identity token key outside tests and local development, passkey begin throws', async () => {
  const { config } = await import('./helpers/identity-engine.mjs'), { linkedCodeKey, ...noKey } = config;
  const f = identityEngine({ config: noKey });
  await assert.rejects(f.act('beginPasskeyLogin', { handle: 'alice', turnstileToken: 'verified' }), /required outside local development/);
  const ok = identityEngine({ config: { ...noKey, linkedEphemeralKey: true } }); assert.ok((await ok.act('beginPasskeyLogin', { handle: 'alice', turnstileToken: 'verified' })).challengeToken);
});

test('organization verification carries hasPasskey and the step-up method, as packages/orgs/ownership.mjs reads them', async () => {
  const { organizationVerification } = await import('../packages/identity/authority-epoch.mjs');
  const { personActor } = await import('../packages/orgs/authority.mjs');
  const withPasskey = { security: { epoch: 1, changedAt: 10 }, passwordHash: 'h', passwordSetAt: 5, credentials: [{ id: 'p', createdAt: 20 }] };
  const byPassword = organizationVerification(withPasskey, { stepUpAt: 30, stepUpCredential: { kind: 'password' } });
  assert.equal(byPassword.hasPasskey, true); assert.equal(byPassword.method, 'password');
  assert.equal(organizationVerification(withPasskey, { stepUpAt: 30, stepUpCredential: { kind: 'passkey', id: 'p' } }).method, 'passkey');
  assert.equal(organizationVerification({ ...withPasskey, credentials: [] }, { stepUpAt: 30, stepUpCredential: { kind: 'password' } }).hasPasskey, false);
  // The fields survive into the org actor the ownership check reads (`actor.verification.hasPasskey/method`).
  const actor = personActor({ owner: '00000000-0000-4000-8000-000000000001', iss: 'https://3sln.example', verification: byPassword });
  assert.equal(actor.verification.hasPasskey, true); assert.equal(actor.verification.method, 'password');
});
