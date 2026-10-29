// Sign-in emails (sign-in and intents spike §3, owner approval 2026-10-28: an address is unverified, verified or
// sign-in; only a verified address becomes a sign-in email; up to 3 verified addresses and one notice address;
// unverified entries expire after 24 hours and hold no uniqueness claim) and the removal process subset implemented in
// this round (§6.4 RM-1, RM-2 Tier A, RM-3; Tier B refused). Engine level over the in-memory, Node and Worker
// repositories, with a seeded chaos test for concurrent claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, MemoryAccounts, memoryShards, signupInput, sessionContext, activate, stepUpPasskey, signInPasskey, passkeyResponse, context } from './helpers/identity-engine.mjs';
import { fakeClock, forEachSeed, createRandom } from './helpers/chaos.mjs';
import { identitySecurityPort } from '../packages/identity/service.mjs';
import { accountEmails, migrateEmails, indexedEmails, UNVERIFIED_EMAIL_TTL_MS, ESTABLISHED_METHOD_AGE_MS } from '../packages/identity/emails.mjs';
import { IdentityRepository } from '../packages/runtime/accounts.mjs';
import { SqliteMetadata } from '../apps/node/resources.mjs';

const MINUTE = 60000, DAY = 86400000, A = 'a@mail.example', B = 'b@mail.example', C = 'c@mail.example', D = 'd@mail.example';
const REPOSITORIES = ['memory', 'node', 'worker'];
const ON = { for: () => ({ enabled: name => name === 'EMAIL_REMOVAL_ENABLED' }) };
function repositoryFor(kind, t, clock) {
  if (kind === 'memory') return new MemoryAccounts();
  if (kind === 'node') { const metadata = new SqliteMetadata(':memory:'); t.after(() => metadata.close()); return new IdentityRepository({ metadata, config: {} }); }
  return memoryShards().repository(clock.now);
}
function harness(t, kind = 'memory', { clock = fakeClock(Date.UTC(2026, 9, 28)), flags = ON, ...overrides } = {}) {
  const repository = repositoryFor(kind, t, clock), alerts = [], push = [];
  const accountChannels = { state: async () => ({ ready: false, count: 0, revision: 'r' }), notify: async (owner, event) => { push.push({ owner, event }); return { accepted: 1 }; } };
  const h = identityEngine({ repository, clock, flags, accountChannels, ...overrides });
  h.resources.mailer.sendSecurityAlert = async value => { alerts.push(value); return { messageId: 'm' + alerts.length }; };
  const settle = () => h.service.settleBackground();
  return { ...h, alerts, push, settle, record: id => repository.get(id), security: id => identitySecurityPort(repository)(id) };
}
const lastToken = (h, purpose, email) => h.mail.filter(m => m.purpose === purpose && (!email || m.email === email)).at(-1)?.token;
async function addAndVerify(h, ctx, email) {
  await h.act('emailStart', { email }, ctx); await h.settle();
  return h.act('emailConfirm', { token: lastToken(h, 'link', email), confirmed: true }, ctx);
}
const emails = result => result.account.emails;
/** Makes an account sign in only by email (as an email sign-up or the password reset leaves it): no passkey. */
const emailOnly = (h, id) => { const record = h.repository.records.get(id); record.credentials = []; };
async function emailSession(h, address) {
  await h.act('emailLoginStart', { email: address, turnstileToken: 'verified' }); await h.settle();
  return sessionContext(await h.act('emailLoginConfirm', { token: lastToken(h, 'login', address), confirmed: true }));
}
async function code(h, run) { try { await run(); } catch (error) { return error.code; } return 'ok'; }

for (const kind of REPOSITORIES) {
  test(`${kind}: an added address is unverified, holds no claim, verifies by its session link and becomes the notice address`, async t => {
    const h = harness(t, kind), { owner, ownerContext } = await activate(h.act);
    const started = await h.act('emailStart', { email: A }, ownerContext); await h.settle();
    assert.equal(started.sent, true);
    assert.deepEqual(emails(started).map(e => [e.address, e.state]), [[A, 'unverified']]);
    assert.equal(emails(started)[0].expiresAt, h.clock.now() + UNVERIFIED_EMAIL_TTL_MS);
    assert.ok(!await h.repository.findByEmail(A), 'an unverified entry never reserves the address');
    const before = (await h.security(owner.account.id)).epoch;
    const confirmed = await h.act('emailConfirm', { token: lastToken(h, 'link', A), confirmed: true }, ownerContext);
    assert.deepEqual(emails(confirmed).map(e => [e.address, e.state, e.notices]), [[A, 'verified', true]]);
    assert.equal(confirmed.account.noticeEmail, A);
    assert.equal((await h.repository.findByEmail(A))?.id, owner.account.id);
    assert.equal((await h.security(owner.account.id)).epoch, before + 1);
  });

  test(`${kind}: verification fails generically when another account verified the address first; the response to adding it is uniform`, async t => {
    const h = harness(t, kind);
    const first = await activate(h.act, signupInput({ handle: 'first' })), second = await activate(h.act, signupInput({ handle: 'second' }));
    await h.act('emailStart', { email: A }, first.ownerContext); await h.settle();
    const firstToken = lastToken(h, 'link', A);
    await addAndVerify(h, second.ownerContext, A);
    assert.equal(await code(h, () => h.act('emailConfirm', { token: firstToken, confirmed: true }, first.ownerContext)), 'invalid_challenge');
    // A third account adding the claimed address gets the same answer, and no mail goes to the address.
    const third = await activate(h.act, signupInput({ handle: 'third' })), mailBefore = h.mail.length;
    const answer = await h.act('emailStart', { email: A }, third.ownerContext); await h.settle();
    assert.equal(answer.sent, true); assert.equal(h.mail.length, mailBefore);
    assert.equal((await h.repository.findByEmail(A)).id, second.owner.account.id);
  });
}

test('unverified entries expire after 24 hours; at most one unverified, a new address replaces it; at most three verified', async t => {
  const h = harness(t), { ownerContext } = await activate(h.act);
  await h.act('emailStart', { email: A }, ownerContext); await h.settle(); const stale = lastToken(h, 'link', A);
  const replaced = await h.act('emailStart', { email: B }, ownerContext); await h.settle();
  assert.deepEqual(emails(replaced).map(e => e.address), [B]);
  assert.equal(await code(h, () => h.act('emailConfirm', { token: stale, confirmed: true }, ownerContext)), 'invalid_challenge');
  h.clock.advance(UNVERIFIED_EMAIL_TTL_MS - MINUTE);
  const late = sessionContext(await signInPasskey(h.act, 'alice', 'passkey-alice'));
  h.clock.advance(MINUTE);
  assert.deepEqual((await h.owner(late)).account.emails, [], 'an expired unverified address is gone');
  assert.equal(await code(h, () => h.act('emailConfirm', { token: lastToken(h, 'link', B), confirmed: true }, late)), 'invalid_challenge');
  for (const email of [A, B, C]) await addAndVerify(h, late, email);
  assert.equal(await code(h, () => h.act('emailStart', { email: D }, late)), 'email_limit');
  assert.equal(await code(h, () => h.act('emailStart', { email: A }, late)), 'email_already_added');
  const notices = await h.act('emailNotices', { address: C }, late);
  assert.deepEqual(emails(notices).filter(e => e.notices).map(e => e.address), [C]);
});

test('only a verified address can become a sign-in email; turning it on needs a fresh passkey step-up, raises the epoch and notifies every channel', async t => {
  const h = harness(t), { owner, ownerContext } = await activate(h.act);
  await h.act('emailStart', { email: A }, ownerContext); await h.settle();
  assert.equal(await code(h, () => h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext)), 'verified_email_required');
  await h.act('emailConfirm', { token: lastToken(h, 'link', A), confirmed: true }, ownerContext);
  h.clock.advance(5 * MINUTE);
  assert.equal(await code(h, () => h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext)), 'step_up_required');
  await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  const before = (await h.security(owner.account.id)).epoch;
  const on = await h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext);
  assert.equal(emails(on)[0].state, 'sign-in'); assert.equal(emails(on)[0].signInSince, h.clock.now()); assert.equal(on.account.signInEmail, true);
  assert.equal((await h.security(owner.account.id)).epoch, before + 1);
  assert.ok(h.alerts.some(a => a.type === 'email-sign-in-enabled' && a.email === A));
  assert.ok(h.push.some(p => p.event === 'email-sign-in-enabled'));
  assert.equal((await h.record(owner.account.id)).emails[0].addedBy.session, 'passkey');
});

test('turning a recent sign-in email off (RM-2 Tier A) needs an established passkey; an established one (Tier B) is refused for now', async t => {
  const h = harness(t), { ownerContext } = await activate(h.act);
  await addAndVerify(h, ownerContext, A); await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  await h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext);
  // The only passkey is younger than 7 days: it cannot undo a recent change.
  assert.equal(await code(h, () => h.act('configureEmailLogin', { address: A, enabled: false }, ownerContext)), 'removal_proof_required');
  // An established passkey (7 days or older) with a recent sign-in email: Tier A undoes it at once.
  const g = harness(t); await activate(g.act);
  g.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  const fresh = sessionContext(await signInPasskey(g.act, 'alice', 'passkey-alice'));
  await addAndVerify(g, fresh, B); await stepUpPasskey(g.act, fresh, 'passkey-alice');
  await g.act('configureEmailLogin', { address: B, enabled: true }, fresh);
  g.clock.advance(6 * MINUTE);
  assert.equal(await code(g, () => g.act('configureEmailLogin', { address: B, enabled: false }, fresh)), 'removal_proof_required', 'the passkey assertion must be fresh (5 minutes)');
  await stepUpPasskey(g.act, fresh, 'passkey-alice');
  const off = await g.act('configureEmailLogin', { address: B, enabled: false }, fresh);
  assert.equal(emails(off)[0].state, 'verified');
  assert.ok(g.alerts.some(a => a.type === 'email-sign-in-removed'));
  // Tier B: once the sign-in email is established, turning it off or deleting it is not available yet (file proof, N6).
  await g.act('configureEmailLogin', { address: B, enabled: true }, fresh);
  g.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  const later = sessionContext(await signInPasskey(g.act, 'alice', 'passkey-alice'));
  await stepUpPasskey(g.act, later, 'passkey-alice');
  assert.equal(await code(g, () => g.act('configureEmailLogin', { address: B, enabled: false }, later)), 'removal_unavailable');
  assert.equal(await code(g, () => g.act('emailRemove', { address: B, confirmed: true }, later)), 'removal_unavailable');
});

test('RM-1 floor, RM-3 undo by email of an email-added sign-in email, and email sessions never count for removal by passkey rules', async t => {
  const h = harness(t, 'memory', { identityBackup: { reissue: async () => ({}), reissueCommit: async () => ({}) } }), { owner, ownerContext } = await activate(h.act);
  await addAndVerify(h, ownerContext, A); await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  await h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext);
  // The only passkey cannot be removed (review 2026-10-29 M2): while it is recent no established passkey can undo it, and
  // once established it is Tier B (file proof, not built). So the email-only state below is the one an email sign-up
  // (P3) or the password reset leaves; it is set directly.
  assert.equal(await code(h, () => h.act('removePasskey', { credentialId: 'passkey-alice' }, ownerContext)), 'removal_proof_required');
  emailOnly(h, owner.account.id);
  // Email-only account: sign in by email; the only sign-in email cannot be turned off (RM-1).
  h.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  await h.act('emailLoginStart', { email: A, turnstileToken: 'verified' }); await h.settle();
  const emailSession = await h.act('emailLoginConfirm', { token: lastToken(h, 'login', A), confirmed: true }), ectx = sessionContext(emailSession);
  assert.equal(await code(h, () => h.act('configureEmailLogin', { address: A, enabled: false }, ectx)), 'last_sign_in_method');
  // SI-4 email step-up: verify and turn on a second address from the fresh email session.
  await addAndVerify(h, ectx, B);
  const on = await h.act('configureEmailLogin', { address: B, enabled: true }, ectx);
  assert.equal(emails(on).find(e => e.address === B).state, 'sign-in');
  assert.equal((await h.record(owner.account.id)).emails.find(e => e.address === B).addedBy.session, 'email');
  // RM-3: a fresh email session from the established sign-in email A undoes B at once.
  h.clock.advance(11 * MINUTE);
  assert.equal(await code(h, () => h.act('configureEmailLogin', { address: B, enabled: false }, ectx)), 'removal_proof_required', 'a stale email session is not a fresh round trip');
  await h.act('emailLoginStart', { email: A, turnstileToken: 'verified' }); await h.settle();
  const again = sessionContext(await h.act('emailLoginConfirm', { token: lastToken(h, 'login', A), confirmed: true }));
  const off = await h.act('configureEmailLogin', { address: B, enabled: false }, again);
  assert.equal(emails(off).find(e => e.address === B).state, 'verified');
  // An email session cannot reissue the recovery file (SI-4; no passkey: add one first).
  assert.equal(await code(h, () => h.act('reissueRecoveryBegin', { acknowledged: true }, again)), 'passkey_required');
});

test('SI-4/Q8 (review 2026-10-29 M1): an email-only account adds a passkey from a fresh email session; every channel is told; RM-3 undoes it from an established sign-in email', async t => {
  const h = harness(t), { owner, ownerContext } = await activate(h.act), id = owner.account.id;
  await addAndVerify(h, ownerContext, A); await addAndVerify(h, ownerContext, B); await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  await h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext); await h.act('configureEmailLogin', { address: B, enabled: true }, ownerContext);
  emailOnly(h, id); h.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  // A stale email session (over 5 minutes) is not the SI-4 step-up.
  const stale = await emailSession(h, A); h.clock.advance(6 * MINUTE);
  assert.equal(await code(h, () => h.act('credentialBegin', { label: 'Laptop' }, stale)), 'reauthentication_required');
  // A fresh email session may add a passkey (and only that among credential changes).
  const ectx = await emailSession(h, A), alertsBefore = h.alerts.length;
  const begin = await h.act('credentialBegin', { label: 'Laptop' }, ectx);
  await h.act('credentialFinish', { challengeId: begin.challengeId, response: passkeyResponse(begin, 'passkey-mail') }, ectx); await h.settle();
  const added = (await h.record(id)).credentials.find(c => c.id === 'passkey-mail');
  assert.deepEqual({ session: added.addedBy.session, emailAddress: added.addedBy.emailAddress }, { session: 'email', emailAddress: A });
  assert.equal(typeof added.addedBy.sessionId, 'string');
  assert.deepEqual(h.alerts.slice(alertsBefore).filter(a => a.type === 'passkey-added').map(a => a.email).sort(), [A, B], 'every address is told');
  assert.ok(h.push.some(p => p.event === 'passkey-added'));
  // With a passkey on the account, an email session no longer counts: a second passkey needs a passkey step-up.
  assert.equal(await code(h, () => h.act('credentialBegin', { label: 'Second' }, ectx)), 'reauthentication_required');
  // An email session never removes a passkey except by RM-3, and a stale one is not a fresh round trip.
  h.clock.advance(11 * MINUTE);
  assert.equal(await code(h, () => h.act('removePasskey', { credentialId: 'passkey-mail' }, ectx)), 'removal_proof_required');
  // RM-3: a fresh email session from the established sign-in email B undoes the email-added passkey at once.
  const undo = await emailSession(h, B), mark = h.alerts.length;
  const removed = await h.act('removePasskey', { credentialId: 'passkey-mail' }, undo); await h.settle();
  assert.deepEqual(removed.credentials, []);
  assert.ok((await h.record(id)).audit.some(e => e.type === 'passkey-removed-by-email'));
  assert.deepEqual(h.alerts.slice(mark).filter(a => a.type === 'passkey-removed').map(a => a.email).sort(), [A, B]);
});

test('RM-3 never removes a passkey added through setup or a passkey; SI-4 does not cover the notice address or removing a verified address', async t => {
  const h = harness(t), { owner, ownerContext } = await activate(h.act), id = owner.account.id;
  await addAndVerify(h, ownerContext, A); await addAndVerify(h, ownerContext, B); await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  await h.act('configureEmailLogin', { address: A, enabled: true }, ownerContext);
  h.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  // Keep the sign-up passkey recent (as if just added) while A is established: it was added through setup, not by email.
  h.repository.records.get(id).credentials[0].createdAt = h.clock.now();
  const ectx = await emailSession(h, A);
  assert.equal(await code(h, () => h.act('removePasskey', { credentialId: 'passkey-alice' }, ectx)), 'removal_proof_required');
  // SI-4 lists adding a passkey, verifying an address and turning sign-in on; the notice address and removals need a passkey.
  emailOnly(h, id); const fresh = await emailSession(h, A);
  assert.equal(await code(h, () => h.act('emailNotices', { address: B }, fresh)), 'reauthentication_required');
  assert.equal(await code(h, () => h.act('emailRemove', { address: B, confirmed: true }, fresh)), 'step_up_required');
});

test('choosing another notice address notifies every address, including the previous and the new one (review 2026-10-29 M3)', async t => {
  const h = harness(t), { ownerContext } = await activate(h.act);
  await addAndVerify(h, ownerContext, A); await addAndVerify(h, ownerContext, B); await addAndVerify(h, ownerContext, C);
  const mark = h.alerts.length;
  await h.act('emailNotices', { address: B }, ownerContext); await h.settle();
  assert.deepEqual(h.alerts.slice(mark).filter(a => a.type === 'notice-email-changed').map(a => a.email).sort(), [A, B, C]);
  assert.ok(h.push.some(p => p.event === 'notice-email-changed'));
  const again = h.alerts.length; await h.act('emailNotices', { address: B }, ownerContext); await h.settle();
  assert.equal(h.alerts.slice(again).filter(a => a.type === 'notice-email-changed').length, 0, 'no change, no notice');
});

test('email sign-in links bind (address, signInSince): turning sign-in off and on again invalidates an outstanding link', async t => {
  const h = harness(t);
  const { ownerContext } = await activate(h.act);
  h.clock.advance(ESTABLISHED_METHOD_AGE_MS);
  const ctx = sessionContext(await signInPasskey(h.act, 'alice', 'passkey-alice'));
  await addAndVerify(h, ctx, A); await stepUpPasskey(h.act, ctx, 'passkey-alice');
  await h.act('configureEmailLogin', { address: A, enabled: true }, ctx);
  await h.act('emailLoginStart', { email: A, turnstileToken: 'verified' }); await h.settle();
  const token = lastToken(h, 'login', A);
  await h.act('configureEmailLogin', { address: A, enabled: false }, ctx);
  await h.act('configureEmailLogin', { address: A, enabled: true }, ctx);
  assert.equal(await code(h, () => h.act('emailLoginConfirm', { token, confirmed: true })), 'unauthorized');
  // A verified (not sign-in) address never gets a sign-in link; the answer is the same.
  await addAndVerify(h, ctx, B); const before = h.mail.length;
  assert.deepEqual(await h.act('emailLoginStart', { email: B, turnstileToken: 'verified' }), { sent: true }); await h.settle();
  assert.equal(h.mail.length, before);
  assert.ok(ownerContext);
});

test('deleting addresses: unverified freely, verified under the DX-6 rules (flag, step-up, notice address moves), sign-in through the removal process', async t => {
  const h = harness(t), { owner, ownerContext } = await activate(h.act);
  await h.act('emailStart', { email: D }, ownerContext); await h.settle();
  const dropped = await h.act('emailRemove', { address: D, confirmed: true }, ownerContext);
  assert.deepEqual(emails(dropped), []);
  await addAndVerify(h, ownerContext, A); await addAndVerify(h, ownerContext, B);
  h.clock.advance(6 * MINUTE);
  assert.equal(await code(h, () => h.act('emailRemove', { address: A, confirmed: true }, ownerContext)), 'step_up_required');
  await stepUpPasskey(h.act, ownerContext, 'passkey-alice');
  const after = await h.act('emailRemove', { address: A, confirmed: true }, ownerContext);
  assert.deepEqual(emails(after).map(e => [e.address, e.notices]), [[B, true]], 'the notice address moved to the remaining address');
  assert.ok(!await h.repository.findByEmail(A), 'the claim is released');
  assert.ok((await h.record(owner.account.id)).previousEmails.some(p => p.email === A));
  const off = harness(t, 'memory', { flags: { for: () => ({ enabled: () => false }) } }), acct = await activate(off.act);
  await addAndVerify(off, acct.ownerContext, C);
  assert.equal(await code(off, () => off.act('emailRemove', { address: C, confirmed: true }, acct.ownerContext)), 'email_removal_unavailable');
});

test('setup code verification: verified by default; sign-in only as an explicit choice; recovery turns sign-in emails back to verified', async t => {
  const h = harness(t);
  const pending = await h.act('signup', signupInput());
  await h.act('registerPasskey', { pendingToken: pending.pendingToken, response: passkeyResponse(pending, 'passkey-alice') });
  await h.act('setupEmailStart', { pendingToken: pending.pendingToken, email: A });
  const setupCode = h.mail.filter(m => m.code).at(-1).code;
  const verified = await h.act('setupEmailConfirm', { pendingToken: pending.pendingToken, code: setupCode, signIn: true });
  assert.equal(verified.verifiedEmail, A); assert.equal(verified.signInEmail, true);
  const file = await h.act('downloadRecovery', { pendingToken: pending.pendingToken });
  const owner = await h.act('confirmRecovery', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true });
  assert.equal(owner.recovered, false);
  assert.deepEqual(owner.account.emails.map(e => [e.address, e.state]), [[A, 'sign-in']]);
  const recovering = await h.act('recover', { recoveryToken: file.recoveryToken, turnstileToken: 'verified' });
  assert.deepEqual((await h.record(owner.account.id)).emails.map(e => e.state), ['verified']);
  await h.act('registerPasskey', { pendingToken: recovering.pendingToken, response: passkeyResponse(await h.act('beginPasskeyRegistration', { pendingToken: recovering.pendingToken }), 'passkey-new') });
  const file2 = await h.act('downloadRecovery', { pendingToken: recovering.pendingToken });
  const back = await h.act('confirmRecovery', { pendingToken: recovering.pendingToken, recoveryToken: file2.recoveryToken, downloadConfirmed: true });
  assert.equal(back.recovered, true);
});

test('legacy single-address records read as one entry and are rewritten on the next identity write; the index keeps the address', async t => {
  const h = harness(t), { owner, ownerContext } = await activate(h.act);
  const raw = h.repository.records.get(owner.account.id);
  Object.assign(raw, { verifiedEmail: A, emailVerifiedAt: h.clock.now(), emailLoginEnabled: true }); delete raw.emails;
  assert.deepEqual(accountEmails(raw).map(e => [e.address, e.state, e.notices]), [[A, 'sign-in', true]]);
  assert.deepEqual(indexedEmails(raw), [A]);
  assert.equal((await h.repository.findByEmail(A))?.id, owner.account.id);
  await h.act('renamePasskey', { credentialId: 'passkey-alice', label: 'Laptop' }, ownerContext);
  const after = await h.record(owner.account.id);
  assert.equal('verifiedEmail' in after, false); assert.equal('emailLoginEnabled' in after, false);
  assert.deepEqual(after.emails.map(e => [e.address, e.state]), [[A, 'sign-in']]);
  const copy = structuredClone(after); migrateEmails(copy); assert.deepEqual(copy.emails, after.emails, 'idempotent');
});

test('chaos: concurrent verification of one address by several accounts leaves exactly one owner (seeded)', async t => {
  await forEachSeed(6, async random => {
    const seed = random.seed, h = harness(t, random.chance(0.5) ? 'memory' : 'worker');
    const people = [];
    for (let i = 0; i < 4; i++) { const p = await activate(h.act, signupInput({ handle: 'p' + i })); await h.act('emailStart', { email: A }, p.ownerContext); people.push({ ...p, token: null }); }
    await h.settle();
    const tokens = h.mail.filter(m => m.purpose === 'link' && m.email === A).map(m => m.token);
    const results = await Promise.allSettled(random.shuffle(people.map((p, i) => [p, tokens[i]])).map(([p, token]) => h.act('emailConfirm', { token, confirmed: true }, p.ownerContext)));
    const winners = results.filter(r => r.status === 'fulfilled');
    assert.ok(winners.length >= 1, `seed ${seed}: someone verifies`);
    const owners = new Set();
    for (const p of people) { const record = await h.record(p.owner.account.id); if (accountEmails(record).some(e => e.address === A && e.state !== 'unverified')) owners.add(p.owner.account.id); }
    assert.equal(owners.size, 1, `seed ${seed}: exactly one account holds the verified address`);
    assert.equal((await h.repository.findByEmail(A)).id, [...owners][0]);
  });
});

test('context sanity: the helper context is the account origin', () => { assert.equal(context.origin, 'https://3sln.example'); });
