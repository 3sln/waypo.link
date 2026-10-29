// Fixes of the independent security review of sign-in P3 (2026-10-29), at engine level. The review's two proofs of
// concept (provisional-passkey laundering, parallel code guesses) are turned into regression tests here, beside one test
// per finding:
//   H1  a provisional passkey counts for nothing in any authority check; whatever traces back to one, or to an email
//       session, is provisional too;
//   coordinator decision 2026-10-29 (provisional): a passkey added from ANY email session is provisional for 24 h for
//       sensitive actions (deletion, export, removals, reissue, revoking other sessions, turning sign-in on for another
//       address, LA-7), while it signs in at once;
//   M1  RM-3 undo only from an ordinary `email` session, never `email-cross-device`;
//   L1  resend charges the mailbox windows (5 per 15 min, 12 per 6 h) shared with start;
//   L2  every code attempt (per flow, per prefix, global) is reserved before the comparison;
//   L3  start does the same storage reads for a known and an unknown address;
//   L4  the account cap is checked before the flow is consumed, and no notice goes out for a refused sign-in;
//   I3  the BroadcastChannel acknowledgement needs the tag;
//   the sign-in notice carries the requester summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, activate, context, config, sessionContext, passkeyResponse, signInPasskey, stepUpPasskey, memoryShards } from './helpers/identity-engine.mjs';
import { fakeClock, concurrently, tally } from './helpers/chaos.mjs';
import { GLOBAL_REDEEM_FLOOR, noticeRequester, requesterLine } from '../packages/identity/email-flow.mjs';
import { MemoryLinkedLimits } from '../packages/identity/linked-approval.mjs';
import { enforceAbusePolicy } from '../packages/core/abuse-policy.mjs';
import { createFlowSecret, ackMessage, acceptAck } from '../apps/web/src/shared/email-flow.mjs';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
const B_R = 'B'.repeat(42) + 'r', B_OTHER = 'O'.repeat(42) + 'x';
const flags = { for: () => ({ enabled: name => ['EMAIL_FLOW_V2', 'EMAIL_SIGNUP_ENABLED'].includes(name) }) };
const requester = { uaSummary: { browser: 'Chrome', system: 'Windows' }, approxLocation: { city: 'Berlin', country: 'DE' } };
const fault = code => error => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; };

function world({ clock = fakeClock(), liveCaps = false, ...overrides } = {}) {
  const mail = [], alerts = [], limits = new MemoryLinkedLimits(clock.now);
  const linkedLimits = liveCaps ? limits : { consume: (key, window) => /^ef-[ab]:/.test(key) ? Promise.resolve(true) : limits.consume(key, window), peek: key => limits.peek(key) };
  const mailer = { sendEmailFlow: async value => { mail.push(value); }, sendSecurityAlert: async value => { alerts.push(value); }, sendVerification: async value => { mail.push(value); }, sendSetupCode: async value => { mail.push(value); } };
  const h = identityEngine({ clock, flags, mailer, linkedLimits, linkedPollLimits: new MemoryLinkedLimits(clock.now), ...overrides });
  const R = (extra = {}) => ({ ...context, emailBrowser: B_R, signupOpen: true, requester, ...extra });
  const H = (extra = {}) => ({ ...context, emailBrowser: B_R, ...extra });
  const other = (extra = {}) => ({ ...context, remoteIP: '203.0.113.9', emailBrowser: B_OTHER, ...extra });
  const settle = () => h.service.settleBackground();
  async function start(email, ctx = R()) {
    const proofs = await createFlowSecret(), before = mail.length;
    const result = await h.act('emailFlowStart', { email, secretHash: proofs.secretHash, channelTag: proofs.channelTag, turnstileToken: 'verified' }, ctx);
    await settle();
    return { ...result, ...proofs, token: mail.slice(before).find(item => item.token)?.token };
  }
  /** A redeemed flow for `email`: same browser (an `email` session) or with a code from another device. */
  async function redeem(email, { crossDevice = false, ctx = R() } = {}) {
    const flow = await start(email, ctx);
    if (crossDevice) { const { code } = await h.act('emailLinkReveal', { t: flow.token, confirmed: true }, other()); return h.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code, confirmed: true }, ctx); }
    await h.act('emailLinkApprove', { t: flow.token, confirmed: true }, H());
    return h.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, ctx);
  }
  const identity = fn => h.engine.container.use(['identity'], ({ identity }) => fn(identity));
  return { ...h, clock, mail, alerts, R, H, other, settle, start, redeem, identity };
}
/** An account created from a create-account link, so its only method is the sign-in email. */
async function emailAccount(w, address, handle, { crossDevice = false } = {}) {
  const redeemed = await w.redeem(address, { crossDevice });
  const pending = await w.act('emailSignupConfirm', { signupToken: redeemed.signup.signupToken, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle }, w.R());
  const file = await w.act('downloadRecovery', { pendingToken: pending.pendingToken }, w.R());
  const active = await w.act('confirmRecovery', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true }, w.R());
  return { id: pending.account.id, handle, owner: sessionContext(active) };
}
/** An active passkey account whose `address` has been a sign-in email for 10 days. */
async function signInAccount(w, address = 'alice@mail.example', { handle = 'alice' } = {}) {
  const active = await activate(w.act, { handle, method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: config.termsVersion, turnstileToken: 'verified' });
  const id = active.owner.account.id, record = await w.repository.get(id), now = w.clock.now();
  record.emails = [{ address, state: 'sign-in', verifiedAt: now - 10 * DAY, signInSince: now - 10 * DAY, notices: true, source: 'linked', addedBy: { session: 'passkey', at: now - 10 * DAY } }];
  assert.equal(await w.repository.compareAndSwap(id, record.revision, { ...record, revision: record.revision + 1 }), true);
  return { ...active, id };
}
async function addPasskey(w, ctx, id) {
  const begin = await w.act('credentialBegin', { label: id }, ctx);
  return w.act('credentialFinish', { challengeId: begin.challengeId, response: passkeyResponse(begin, id) }, ctx);
}
async function patch(w, id, change) { const record = await w.repository.get(id); change(record); assert.equal(await w.repository.compareAndSwap(id, record.revision, { ...record, revision: record.revision + 1 }), true); }
const outcome = promise => promise.then(() => 'ok', error => error.code);

test('H1 (proof of concept 2): a provisional passkey from a cross-device email session gives no step-up, no recent authority, no LA-7 and no privileged access; nothing can be laundered through it', async () => {
  const w = world(), { id, owner } = await emailAccount(w, 'tv@mail.example', 'tvuser', { crossDevice: true });
  await addPasskey(w, owner, 'pk-1');
  const p1 = (await w.repository.get(id)).credentials.find(c => c.id === 'pk-1');
  assert.equal(p1.provisionalUntil, w.clock.now() + DAY); assert.equal(p1.addedBy.session, 'email-cross-device');
  // In the same session: no step-up with it, so no privileged access and no revoking the owner's other sessions.
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, owner)), 'reauthentication_required');
  assert.deepEqual(await w.act('stepUpBegin', {}, owner), { passkey: false, provisionalUntil: p1.provisionalUntil }, 'the prompt can say when it will count');
  await assert.rejects(w.act('stepUp', { method: 'passkey', response: passkeyResponse(await w.identity(identity => identity.webauthn.authenticationOptions({})), 'pk-1') }, owner), fault('unauthorized'), 'no step-up challenge was issued');
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, owner)), 'reauthentication_required');
  assert.equal(await outcome(w.service.privileged(owner)), 'step_up_required');
  // Signing in with it works, but the session is `passkey-provisional`: no freshness of any kind.
  const signed = await signInPasskey(w.act, 'tvuser', 'pk-1'), attacker = sessionContext(signed);
  const record = await w.repository.get(id), session = record.sessions.at(-1);
  assert.equal(session.source, 'passkey-provisional'); assert.equal(session.credentialId, 'pk-1');
  assert.deepEqual(await w.identity(identity => [identity.authAt(session, record), identity.authAt(session), identity.approvalAuthAt(record, session)]), [-Infinity, -Infinity, -Infinity]);
  assert.equal((await w.owner(attacker)).authTime, null);
  // A direct step-up attempt with it is refused even when a challenge exists (the account has an established passkey
  // only in the second half of this test, so here the challenge is forced into the record).
  await patch(w, id, r => { r.challenges = [...r.challenges, { purpose: 'step-up', value: 'forced-challenge', sessionHash: r.sessions.at(-1).hash, expiresAt: w.clock.now() + MINUTE }]; });
  await assert.rejects(w.act('stepUp', { method: 'passkey', response: { id: 'pk-1', challenge: 'forced-challenge' } }, attacker), fault('passkey_provisional'));
  assert.equal((await w.repository.get(id)).sessions.at(-1).stepUpAt, undefined);
  // (a) no second passkey from its session;
  assert.equal(await outcome(w.act('credentialBegin', { label: 'P2' }, attacker)), 'reauthentication_required');
  // (b) no sign-in for an attacker-controlled verified address;
  await patch(w, id, r => r.emails.push({ address: 'attacker@mail.example', state: 'verified', verifiedAt: w.clock.now(), notices: false, source: 'linked', addedBy: { session: 'email-cross-device', at: w.clock.now() } }));
  assert.equal(await outcome(w.act('configureEmailLogin', { address: 'attacker@mail.example', enabled: true }, attacker)), 'step_up_required');
  assert.equal((await w.repository.get(id)).emails.find(e => e.address === 'attacker@mail.example').state, 'verified');
  // (c) no revoking the owner's other sessions; (d) no privileged access (deletion, export, DX-6 email removal).
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, attacker)), 'reauthentication_required');
  assert.equal(await outcome(w.service.privileged(attacker)), 'step_up_required');
  assert.equal(await outcome(w.act('renamePasskey', { credentialId: 'pk-1', label: 'x' }, attacker)), 'reauthentication_required');
  // The email session's SI-4 allowance ended with the first passkey (fail closed: a mailbox holder cannot fill the five
  // passkey slots), and nothing else gives authority, so no further passkey or verified address for 24 hours.
  assert.equal(await outcome(w.act('credentialBegin', { label: 'P2' }, owner)), 'reauthentication_required');
  assert.equal(await outcome(w.act('emailStart', { email: 'third@mail.example' }, attacker)), 'reauthentication_required');
  assert.equal((await w.repository.get(id)).credentials.length, 1);
  // After 24 hours the passkey is an ordinary one: it signs in with authority and steps up.
  w.clock.advance(DAY);
  const later = sessionContext(await signInPasskey(w.act, 'tvuser', 'pk-1')), laterRecord = await w.repository.get(id);
  assert.equal(laterRecord.sessions.at(-1).source, 'credential');
  assert.equal(await w.identity(identity => identity.approvalAuthAt(laterRecord, laterRecord.sessions.at(-1))), w.clock.now());
  await stepUpPasskey(w.act, later, 'pk-1');
  assert.equal(await outcome(w.service.privileged(later)), 'ok');
  // The provisional sign-in session from earlier never gains authority, even after its passkey became established.
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, attacker)), 'unauthorized', 'it expired with its 24-hour life');
});

test('coordinator decision 2026-10-29: a passkey added from a same-browser email session is provisional for 24 h: it signs in at once, but deletion, export, removals, reissue, revoking sessions, turning on another sign-in email and LA-7 wait (closes the pre-P3 step-up gap)', async () => {
  const w = world(), { id, owner } = await emailAccount(w, 'only@mail.example', 'onlyemail');
  assert.equal((await w.repository.get(id)).sessions.at(-1).source, 'email');
  await addPasskey(w, owner, 'pk-e');
  const added = (await w.repository.get(id)).credentials[0];
  assert.deepEqual([added.addedBy.session, added.addedBy.emailAddress, added.provisionalUntil], ['email', 'only@mail.example', w.clock.now() + DAY]);
  // The pre-P3 gap: email session → passkey → step-up → deletion or export. The step-up is refused now.
  const signed = sessionContext(await signInPasskey(w.act, 'onlyemail', 'pk-e'));
  assert.equal((await w.owner(signed)).account.handle, 'onlyemail', 'ordinary sign-in works immediately');
  await patch(w, id, r => { r.challenges = [...r.challenges, { purpose: 'step-up', value: 'forced', sessionHash: r.sessions.at(-1).hash, expiresAt: w.clock.now() + MINUTE }]; });
  await assert.rejects(w.act('stepUp', { method: 'passkey', response: { id: 'pk-e', challenge: 'forced' } }, signed), fault('passkey_provisional'));
  assert.equal(await outcome(w.service.privileged(signed)), 'step_up_required', 'deletion and export need privileged()');
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, signed)), 'reauthentication_required');
  assert.equal(await outcome(w.act('removePasskey', { credentialId: 'pk-e' }, signed)), 'removal_proof_required');
  const record = await w.repository.get(id);
  assert.equal(await outcome(w.identity(async identity => identity.reissueAuthority(record, record.sessions.at(-1)))), 'reauthentication_required', 'no reissue');
  assert.equal(await w.identity(identity => identity.approvalAuthAt(record, record.sessions.at(-1))), -Infinity, 'LA-7');
  // Turning sign-in on for another address: the provisional passkey cannot (and the SI-4 email step-up ended with it).
  await patch(w, id, r => r.emails.push({ address: 'second@mail.example', state: 'verified', verifiedAt: w.clock.now(), notices: false, source: 'linked', addedBy: { session: 'email', at: w.clock.now() } }));
  assert.equal(await outcome(w.act('configureEmailLogin', { address: 'second@mail.example', enabled: true }, signed)), 'step_up_required');
  // After 24 hours the passkey counts: it steps up, and privileged access follows.
  w.clock.advance(DAY);
  const later = sessionContext(await signInPasskey(w.act, 'onlyemail', 'pk-e'));
  await stepUpPasskey(w.act, later, 'pk-e');
  assert.equal(await outcome(w.service.privileged(later)), 'ok');
  assert.equal(await outcome(w.act('revokeOtherSessions', {}, later)), 'ok');
});

test('H1 provenance: a passkey registered while setting up an account from a create-account link is email-added and provisional', async () => {
  const w = world(), redeemed = await w.redeem('setup@mail.example', { crossDevice: true });
  const pending = await w.act('emailSignupConfirm', { signupToken: redeemed.signup.signupToken, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle: 'setupper' }, w.R());
  const begin = await w.act('beginPasskeyRegistration', { pendingToken: pending.pendingToken }, w.R());
  await w.act('registerPasskey', { pendingToken: pending.pendingToken, response: passkeyResponse(begin, 'pk-setup') }, w.R());
  const credential = (await w.repository.get(pending.account.id)).credentials[0];
  assert.deepEqual([credential.addedBy.session, credential.addedBy.emailAddress, credential.provisionalUntil], ['email-cross-device', 'setup@mail.example', w.clock.now() + DAY]);
  // A passkey sign-up's own setup passkey stays ordinary.
  const passkeyAccount = await activate(w.act, { handle: 'plain', method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: config.termsVersion, turnstileToken: 'verified' });
  const plain = (await w.repository.get(passkeyAccount.owner.account.id)).credentials[0];
  assert.deepEqual([plain.addedBy.session, plain.provisionalUntil], ['setup', undefined]);
});

test('M1: RM-3 undo works from an ordinary email session only, never from an email-cross-device session (passkeys and sign-in emails)', async () => {
  const w = world(), alice = await signInAccount(w);
  w.clock.advance(8 * DAY);
  const now = w.clock.now();
  await patch(w, alice.id, r => {
    r.credentials.push({ id: 'pk-recent', publicKey: 'fake-public-key', counter: 0, transports: [], deviceType: 'multiDevice', backedUp: true, label: 'Recent', createdAt: now - DAY, addedBy: { session: 'email', at: now - DAY, emailAddress: 'alice@mail.example' } });
    r.emails.push({ address: 'recent@mail.example', state: 'sign-in', verifiedAt: now - DAY, signInSince: now - DAY, notices: false, source: 'linked', addedBy: { session: 'email', at: now - DAY } });
  });
  const cross = await w.redeem('alice@mail.example', { crossDevice: true }), crossCtx = sessionContext(cross);
  assert.equal(cross.source, 'email-cross-device');
  assert.equal(await outcome(w.act('removePasskey', { credentialId: 'pk-recent' }, crossCtx)), 'step_up_required');
  assert.equal(await outcome(w.act('configureEmailLogin', { address: 'recent@mail.example', enabled: false }, crossCtx)), 'removal_proof_required');
  const same = await w.redeem('alice@mail.example'), sameCtx = sessionContext(same);
  assert.equal(same.source, 'email');
  assert.equal((await w.act('removePasskey', { credentialId: 'pk-recent' }, sameCtx)).removed, true);
  const again = sessionContext(await w.redeem('alice@mail.example'));
  assert.equal((await w.act('configureEmailLogin', { address: 'recent@mail.example', enabled: false }, again)).emailLoginEnabled, false);
});

test('L1: a resend charges the same mailbox windows as start (5 per 15 minutes, 12 per 6 hours), on every branch', async () => {
  const clock = fakeClock(), windows = new MemoryLinkedLimits(clock.now);
  const resource = { consume: ({ key, windowMs, limit }) => windows.consume(key, { windowMs, limit }) };
  const rateLimiter = { check: async input => input.phase !== 'mailbox' || enforceAbusePolicy(resource, { ...input, handleHash: input.handle, regionHash: input.region ?? 'region', ipHash: input.remoteIP }) };
  const w = world({ clock, rateLimiter }); await signInAccount(w);
  const sends = async email => {
    let ok = 0;
    for (let at = 0; at < 6 * HOUR; at += 16 * MINUTE) {
      let flow = null;
      try { flow = await w.start(email); ok++; } catch (error) { assert.equal(error.code, 'rate_limited'); }
      if (flow) for (let i = 0; i < 3; i++) { try { await w.act('emailFlowResend', { flowId: flow.flowId, secret: flow.secret }, w.R()); ok++; } catch (error) { assert.equal(error.code, 'rate_limited'); } }
      clock.advance(16 * MINUTE);
    }
    return ok;
  };
  // Within 15 minutes: one start and three resends are four sends; a second start is the fifth, then nothing.
  const first = await w.start('alice@mail.example');
  for (let i = 0; i < 3; i++) await w.act('emailFlowResend', { flowId: first.flowId, secret: first.secret }, w.R());
  const second = await w.start('alice@mail.example');
  await assert.rejects(w.act('emailFlowResend', { flowId: second.flowId, secret: second.secret }, w.R()), fault('rate_limited'));
  await assert.rejects(w.start('alice@mail.example'), fault('rate_limited'));
  await w.settle();
  assert.equal(w.mail.filter(m => m.email === 'alice@mail.example').length, 5);
  // Over 6 hours the mailbox gets at most 12 mails, starts and resends together (the spike's "resend counts as a send").
  clock.advance(6 * HOUR); const before = w.mail.filter(m => m.email === 'alice@mail.example').length;
  const known = await sends('alice@mail.example'); await w.settle();
  assert.equal(known, 12); assert.equal(w.mail.filter(m => m.email === 'alice@mail.example').length - before, 12);
  // An unknown address (an inert flow, nothing mailed) is charged identically.
  assert.equal(await sends('nobody@mail.example'), 12);
});

test('L2 (proof of concept 1): parallel wrong codes never evaluate more than 5 codes per flow, and per-prefix and global budgets are reserved before any comparison', async () => {
  for (const position of [0, 4, 5, 20, 59]) {
    const w = world(); await signInAccount(w);
    const flow = await w.start('alice@mail.example'), { code } = await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other());
    let compared = 0; await w.identity(identity => { const mac = identity.mac.bind(identity); identity.mac = (purpose, value) => { if (purpose === 'email-flow-code') compared++; return mac(purpose, value); }; });
    const guesses = Array.from({ length: 60 }, (_, i) => String((Number(code) + 1 + i) % 1e6).padStart(6, '0')); guesses[position] = code;
    const results = await concurrently(guesses.map((guess, i) => () => w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: guess, confirmed: true }, w.R({ remoteIP: `198.51.${i}.7` }))));
    const counts = tally(results, value => value.source);
    assert.ok(compared <= 5, `at most 5 codes compared (position ${position}): ${compared}`);
    assert.ok((counts['email-cross-device'] ?? 0) + (counts.invalid_code ?? 0) <= 5, JSON.stringify(counts));
    assert.ok((counts['email-cross-device'] ?? 0) <= 1);
    const stored = await w.identity(identity => identity.emailFlows.get(flow.flowId));
    assert.ok(stored.codeAttempts <= 5);
  }
  // Network prefix: 25 parallel wrong codes on 25 flows from one /24 evaluate exactly 20.
  const p = world(); await signInAccount(p);
  const flows = [];
  for (let i = 0; i < 25; i++) { const flow = await p.start('alice@mail.example'); await p.act('emailLinkReveal', { t: flow.token, confirmed: true }, p.other()); flows.push(flow); }
  const prefix = tally(await concurrently(flows.map(flow => () => p.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: 'abcdef', confirmed: true }, p.R()))));
  assert.deepEqual(prefix, { invalid_code: 20, rate_limited: 5 });
  // Global budget: with 3 units left, 10 parallel wrong codes from 10 networks: 3 are evaluated, 7 need Turnstile.
  const g = world(); await signInAccount(g);
  await g.identity(async identity => { identity.emailFlow().liveCodes = async () => 1e9; for (let i = 0; i < GLOBAL_REDEEM_FLOOR - 3; i++) await identity.linkedLimits.consume('ef-g', { windowMs: HOUR, limit: GLOBAL_REDEEM_FLOOR }); });
  const many = [];
  for (let i = 0; i < 10; i++) { const flow = await g.start('alice@mail.example'); await g.act('emailLinkReveal', { t: flow.token, confirmed: true }, g.other()); many.push(flow); }
  const global = tally(await concurrently(many.map((flow, i) => () => g.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: 'abcdef', confirmed: true }, g.R({ remoteIP: `198.51.${100 + i}.7` })))));
  assert.deepEqual(global, { invalid_code: 3, challenge_required: 7 });
});

test('L3: start makes the same shard reads for a known and an unknown address (Worker sharded repository)', async () => {
  const calls = []; let recording = false;
  const shards = memoryShards({ wrap: stub => new Proxy(stub, { get: (target, method) => typeof method === 'string' && method.startsWith('shard') ? (...args) => { if (recording) calls.push(method); return target[method](...args); } : target[method] }) });
  const clock = fakeClock(), w = world({ clock, repository: shards.repository(clock.now) });
  await signInAccount(w);
  const work = {};
  for (const [branch, email] of [['known', 'alice@mail.example'], ['unknown', 'nobody@mail.example'], ['sign-up', 'new@mail.example']]) {
    const proofs = await createFlowSecret(); calls.length = 0; recording = true;
    await w.act('emailFlowStart', { email, secretHash: proofs.secretHash, channelTag: proofs.channelTag, turnstileToken: 'verified' }, w.R({ emailBrowser: `${'U'.repeat(42)}${branch.length}` }));
    recording = false; work[branch] = [...calls]; await w.settle();
  }
  assert.ok(work.known.length > 0);
  assert.deepEqual(work.unknown, work.known); assert.deepEqual(work['sign-up'], work.known);
});

test('L4: the account cap is checked before the flow is consumed; a refused sign-in sends no notice and the same flow redeems after signing out of an account', async () => {
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  await w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.H());
  const others = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
  await w.settle(); const alertsBefore = w.alerts.length;
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R({ accountMembers: { owners: others, limit: 5 } })), fault('account_limit'));
  await w.settle();
  assert.equal(w.alerts.length, alertsBefore, 'no "new sign-in" notice for a refused sign-in');
  assert.equal((await w.identity(identity => identity.emailFlows.get(flow.flowId))).state, 'approved-same-browser', 'the flow is not consumed');
  // An account that is already one of the browser's accounts replaces its own session: no cap.
  const result = await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R({ accountMembers: { owners: [...others.slice(0, 4), alice.id], limit: 5 } }));
  assert.equal(result.source, 'email');
  await w.settle(); assert.equal(w.alerts.filter(a => a.type === 'email-sign-in').length, 1);
  // The code path checks the cap before it reserves a code attempt.
  const coded = await w.start('alice@mail.example'), { code } = await w.act('emailLinkReveal', { t: coded.token, confirmed: true }, w.other());
  await assert.rejects(w.act('emailFlowRedeem', { flowId: coded.flowId, secret: coded.secret, code, confirmed: true }, w.R({ accountMembers: { owners: others, limit: 5 } })), fault('account_limit'));
  assert.equal((await w.identity(identity => identity.emailFlows.get(coded.flowId))).codeAttempts, 0);
});

test('the email sign-in notice carries the requester summary from the fixed vocabulary only', async () => {
  const w = world(); await signInAccount(w);
  await w.redeem('alice@mail.example'); await w.settle();
  const notice = w.alerts.find(a => a.type === 'email-sign-in');
  assert.deepEqual(notice.requester, { browser: 'Chrome', system: 'Windows', location: { city: 'Berlin', country: 'DE' } });
  assert.equal(requesterLine(notice.requester), 'Requested from Chrome on Windows, near Berlin, DE (approximate; a VPN can change the place).');
  assert.equal(requesterLine({ browser: 'Evil\nBcc: x', system: 'Windows', location: { city: 'A\r\nB' } }), 'Requested from Windows (approximate; a VPN can change the place).');
  assert.equal(requesterLine(null), ''); assert.equal(noticeRequester({}), null);
});

test('I3: the original tab\'s BroadcastChannel acknowledgement needs this flow\'s tag', async () => {
  const one = await createFlowSecret(), two = await createFlowSecret(), flowId = 'F'.repeat(22), mine = { flowId, channelTag: one.channelTag };
  assert.equal(acceptAck(ackMessage(mine), mine), true);
  for (const forged of [{ v: 1, type: 'ack', flowId }, ackMessage({ flowId, channelTag: two.channelTag }), ackMessage({ flowId: 'G'.repeat(22), channelTag: one.channelTag }), { ...ackMessage(mine), type: 'approved' }, null])
    assert.equal(acceptAck(forged, mine), false, JSON.stringify(forged));
});
