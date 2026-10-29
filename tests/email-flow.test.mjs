// Cross-device email sign-in link and email sign-up at engine level (sign-in and intents spike §3.4, §3.6, §4, §5; P3,
// provisional protocol behind EMAIL_FLOW_V2 / EMAIL_SIGNUP_ENABLED; direction owner-approved 2026-10-28). Every state
// transition of packages/identity/email-flow.mjs, the testable threat-table mitigations (T1 interception, T2 scanners,
// T5 fixation, T9 replay, T10 brute force, T12/T13 enumeration and work parity, T14 BroadcastChannel spoofing, T17
// races and epoch changes), the closed-tab fallback (N8), N2 cross-device sessions, the sign-up branch with the
// post-sign-up passkey suggestion, and seeded chaos over concurrent flows. All through the identity engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, activate, context, config, sessionContext, passkeyResponse, signInPasskey } from './helpers/identity-engine.mjs';
import { fakeClock, forEachSeed, concurrently } from './helpers/chaos.mjs';
import { EMAIL_FLOW, maskAddress, requesterSummary, globalRedeemBudget, GLOBAL_REDEEM_FLOOR } from '../packages/identity/email-flow.mjs';
import { MemoryLinkedLimits } from '../packages/identity/linked-approval.mjs';
import { createFlowSecret, acceptWake, wakeMessage, flowProofs } from '../apps/web/src/shared/email-flow.mjs';
import { hostItems, PASSKEY_SUGGESTION_REPEAT_MS } from '../packages/identity/service.mjs';

const MINUTE = 60000, DAY = 86400000;
const B_R = 'B'.repeat(42) + 'r', B_OTHER = 'O'.repeat(42) + 'x';
const flagsOn = (names = ['EMAIL_FLOW_V2', 'EMAIL_SIGNUP_ENABLED']) => ({ for: () => ({ enabled: name => names.includes(name) }) });
const requester = { uaSummary: { browser: 'Chrome', system: 'Windows' }, approxLocation: { city: 'Berlin', country: 'DE' } };

function world({ flags = flagsOn(), clock = fakeClock(), mailer: extraMailer = {}, liveCaps = true, ...overrides } = {}) {
  const mail = [], alerts = [], limits = new MemoryLinkedLimits(clock.now);
  // `liveCaps: false` lifts only the per-address and per-browser live-flow windows (tests that need many flows).
  const linkedLimits = liveCaps ? limits : { consume: (key, window) => /^ef-[ab]:/.test(key) ? Promise.resolve(true) : limits.consume(key, window), peek: key => limits.peek(key) };
  const mailer = { sendEmailFlow: async value => { mail.push(value); }, sendSecurityAlert: async value => { alerts.push(value); }, sendVerification: async value => { mail.push(value); }, sendSetupCode: async value => { mail.push(value); }, ...extraMailer };
  const h = identityEngine({ clock, flags, mailer, linkedLimits, linkedPollLimits: new MemoryLinkedLimits(clock.now), ...overrides });
  const R = (extra = {}) => ({ ...context, emailBrowser: B_R, signupOpen: true, requester, ...extra });
  const H = (extra = {}) => ({ ...context, emailBrowser: B_R, ...extra });
  const other = (extra = {}) => ({ ...context, remoteIP: '203.0.113.9', emailBrowser: B_OTHER, ...extra });
  const settle = () => h.service.settleBackground();
  /** R starts a flow; resolves {flowId, secret, channelTag, token (from the mail, if any)}. */
  async function start(email, ctx = R(), input = {}) {
    const proofs = await createFlowSecret(), before = mail.length;
    const result = await h.act('emailFlowStart', { email, secretHash: proofs.secretHash, channelTag: proofs.channelTag, turnstileToken: 'verified', ...input }, ctx);
    await settle();
    const sent = mail.slice(before).find(item => item.email === email.replace(/@(.*)$/, (_, d) => '@' + d.toLowerCase()) && item.token);
    return { ...result, ...proofs, token: sent?.token, sent: mail.slice(before) };
  }
  const status = async (flow, secret = flow.secret) => { clock.advance(EMAIL_FLOW.interval * 1000); return h.act('emailFlowStatus', { flowId: flow.flowId, secret }, R()); };
  const store = () => h.service.emailFlows ?? null;
  return { ...h, clock, mail, alerts, R, H, other, settle, start, status, store };
}
/** An active passkey account `alice` whose address is a sign-in email. */
async function signInAccount(w, address = 'alice@mail.example', { handle = 'alice' } = {}) {
  const active = await activate(w.act, { handle, method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: config.termsVersion, turnstileToken: 'verified' });
  const id = active.owner.account.id, record = await w.repository.get(id), now = w.clock.now();
  record.emails = [{ address, state: 'sign-in', verifiedAt: now - 10 * DAY, signInSince: now - 10 * DAY, notices: true, source: 'linked', addedBy: { session: 'passkey', at: now - 10 * DAY } }];
  assert.equal(await w.repository.compareAndSwap(id, record.revision, { ...record, revision: record.revision + 1 }), true);
  return { ...active, id };
}
const flowRecord = (w, flowId) => w.engine.container.use(['identity'], ({ identity }) => identity.emailFlows.get(flowId));
const fault = code => error => { assert.equal(error.code, code, `${error.code}: ${error.message}`); return true; };

test('flags: everything is refused while EMAIL_FLOW_V2 is off; with it on the older bearer link is refused', async () => {
  const off = world({ flags: flagsOn([]) });
  await assert.rejects(off.act('emailFlowStart', { email: 'a@mail.example', secretHash: 'a'.repeat(43), channelTag: 'b'.repeat(43), turnstileToken: 'verified' }, off.R()), fault('not_found'));
  for (const method of ['emailLinkInspect', 'emailLinkApprove', 'emailLinkReveal', 'emailFlowStatus', 'emailFlowRedeem', 'emailLinkCompleteHere', 'emailSignupConfirm']) await assert.rejects(off.act(method, { t: 'x'.repeat(43), confirmed: true }, off.R()), fault('not_found'));
  assert.deepEqual(await off.act('emailLoginStart', { email: 'a@mail.example', turnstileToken: 'verified' }), { sent: true });
  const on = world();
  await assert.rejects(on.act('emailLoginStart', { email: 'a@mail.example', turnstileToken: 'verified' }), fault('not_found'));
  // EMAIL_SIGNUP_ENABLED off: an unknown address gets the closed notice, never a create-account link.
  const noSignup = world({ flags: flagsOn(['EMAIL_FLOW_V2']) }), flow = await noSignup.start('new@mail.example');
  assert.equal(flow.token, undefined); assert.deepEqual(noSignup.mail.map(m => m.purpose), ['notice-closed']);
  assert.equal((await flowRecord(noSignup, flow.flowId)).purpose, 'inert');
});

test('start: one response shape and the same synchronous work on every branch; mail only after the response (T12, T13, §3.6)', async () => {
  const w = world(), calls = [];
  // The notice window (`ef-n:`) is charged in the background, after the response; everything else must match.
  const count = (name, target) => new Proxy(target, { get: (object, method) => typeof object[method] === 'function' ? (...args) => { if (!(typeof args[0] === 'string' && args[0].startsWith('ef-n:'))) calls.push(`${name}.${String(method)}${name === 'limits' ? ':' + String(args[0]).split(':')[0] : ''}`); return object[method](...args); } : object[method] });
  await w.engine.container.use(['identity'], ({ identity }) => { identity.emailFlows = count('store', identity.emailFlows); identity.linkedLimits = count('limits', identity.linkedLimits); identity.repository = count('repo', identity.repository); });
  const alice = await signInAccount(w);
  // A verified (not sign-in) address on another active account, and a suspended account's sign-in email.
  const bob = await activate(w.act, { handle: 'bob', method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: config.termsVersion, turnstileToken: 'verified' }, { passkeyId: 'pk-bob' });
  for (const [id, address, state, status] of [[bob.owner.account.id, 'bob@mail.example', 'verified', 'active']]) { const record = await w.repository.get(id); record.emails = [{ address, state, verifiedAt: 1, notices: true, source: 'linked', addedBy: { session: 'passkey', at: 1 } }]; record.status = status; await w.repository.compareAndSwap(id, record.revision, { ...record, revision: record.revision + 1 }); }
  const carol = await signInAccount(w, 'carol@mail.example', { handle: 'carol' }), cr = await w.repository.get(carol.id); cr.status = 'suspended'; await w.repository.compareAndSwap(carol.id, cr.revision, { ...cr, revision: cr.revision + 1 });
  const branches = { 'sign-in': 'alice@mail.example', verified: 'bob@mail.example', 'sign-up': 'new@mail.example', suspended: 'carol@mail.example' };
  const closed = { 'closed': 'closed@mail.example' };
  const shapes = {}, work = {};
  let index = 0;
  for (const [branch, email] of [...Object.entries(branches), ...Object.entries(closed)]) {
    // Mail is held until released: the response must not wait for it.
    let release; const gate = new Promise(resolve => { release = resolve; }); let mailed = false;
    await w.engine.container.use(['identity'], ({ identity }) => { identity.mailer.sendEmailFlow = async value => { await gate; mailed = true; w.mail.push(value); }; });
    calls.length = 0; const proofs = await createFlowSecret();
    const result = await w.act('emailFlowStart', { email, secretHash: proofs.secretHash, channelTag: proofs.channelTag, turnstileToken: 'verified' }, w.R({ signupOpen: branch !== 'closed', emailBrowser: `${'U'.repeat(42)}${index++}` }));
    work[branch] = [...calls]; shapes[branch] = { keys: Object.keys(result).sort(), size: JSON.stringify(result).length, expiresIn: result.expiresIn, interval: result.interval };
    assert.equal(mailed, false, `${branch}: the response did not wait for mail`);
    release(); await w.settle();
  }
  for (const branch of Object.keys(shapes)) { assert.deepEqual(shapes[branch], shapes['sign-in'], branch); assert.deepEqual(work[branch], work['sign-in'], `${branch} does the same synchronous work as sign-in`); }
  assert.deepEqual(shapes['sign-in'], { keys: ['expiresIn', 'flowId', 'interval'], size: shapes['sign-in'].size, expiresIn: 900, interval: 3 });
  const byAddress = Object.fromEntries(w.mail.filter(m => m.purpose).map(m => [m.email, m.purpose]));
  assert.deepEqual(byAddress, { 'alice@mail.example': 'sign-in', 'bob@mail.example': 'notice-verified', 'new@mail.example': 'sign-up', 'closed@mail.example': 'notice-closed' });
  assert.equal(w.mail.filter(m => m.purpose === 'notice-verified').every(m => m.token === undefined), true, 'the notice carries no link');
  // The link-free notice goes out at most once per 24 h; the flow is still created and answered identically.
  const again = await w.start('bob@mail.example'); assert.equal(w.mail.filter(m => m.purpose === 'notice-verified').length, 1); assert.equal(typeof again.flowId, 'string');
  // A non-completing flow polls `pending` like a live one the user never opened.
  assert.equal((await w.status(again)).status, 'pending');
  void alice;
});

test('same-browser fast path: inspect (read-only), explicit approve with B, status, redeem with S; one fresh email session (EL-1, EL-3, EL-5, T5, T9)', async () => {
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  assert.match(flow.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(flow.token.includes(alice.id), false, 'the token holds no account id');
  assert.equal((await w.status(flow)).status, 'pending');
  // Repeated inspects change only the counter.
  for (let i = 0; i < 3; i++) { const view = await w.act('emailLinkInspect', { t: flow.token }, w.H()); assert.deepEqual({ purpose: view.purpose, handle: view.account.handle, sameBrowser: view.sameBrowser, state: view.state }, { purpose: 'sign-in', handle: 'alice', sameBrowser: true, state: 'pending' }); assert.deepEqual(view.requester.uaSummary, requester.uaSummary); }
  assert.equal((await flowRecord(w, flow.flowId)).state, 'pending');
  await assert.rejects(w.act('emailLinkApprove', { t: flow.token }, w.H()), fault('confirmation_required'));
  const approved = await w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.H());
  assert.deepEqual(approved, { approved: true, flowId: flow.flowId, channelTag: flow.channelTag });
  await assert.rejects(w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.H()), fault('invalid_link'), 'the link is used up');
  assert.deepEqual(await w.act('emailLinkInspect', { t: flow.token }, w.H()), { invalid: true });
  assert.equal((await w.status(flow)).status, 'approved');
  const before = (await w.repository.get(alice.id)).sessions.length;
  const result = await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R());
  assert.equal(result.source, 'email'); assert.equal(result.account.handle, 'alice'); assert.match(result.sessionToken, new RegExp(`^${alice.id}\\.`));
  for (const value of [flow.flowId, flow.secret, flow.token, B_R]) assert.equal(result.sessionToken.includes(value), false, 'the session is never derived from the flow');
  const record = await w.repository.get(alice.id); assert.equal(record.sessions.length, before + 1); assert.equal(record.sessions.at(-1).source, 'email'); assert.equal(record.sessions.at(-1).emailAddress, 'alice@mail.example');
  // Replay: the flow is consumed.
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R()), fault('invalid_flow'));
  assert.equal((await w.status(flow)).status, 'expired');
  await w.settle(); assert.equal(w.alerts.some(a => a.type === 'email-sign-in' && a.email === 'alice@mail.example'), true, 'the sign-in notice goes to every channel');
  const stored = await flowRecord(w, flow.flowId); assert.equal(stored.state, 'redeemed'); assert.equal(stored.redeemedVia, 'same-browser'); assert.equal('channelTag' in stored, false);
  for (const key of Object.keys(stored)) assert.equal(['intent', 'returnTo', 'secret', 'token', 'code'].includes(key), false, 'EL-8');
});

test('another device: no approve without B; the confirmed reveal shows a flow-bound code (same code up to 3 reveals); redeem needs S and C; cross-device session (T1, T4, N2)', async () => {
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  const view = await w.act('emailLinkInspect', { t: flow.token }, w.other()); assert.equal(view.sameBrowser, false);
  await assert.rejects(w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.other()), fault('invalid_link'));
  await assert.rejects(w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.other({ emailBrowser: undefined })), fault('invalid_link'));
  await assert.rejects(w.act('emailLinkReveal', { t: flow.token }, w.other()), fault('confirmation_required'));
  const first = await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other()); assert.match(first.code, /^\d{6}$/); assert.ok(first.expiresAt <= w.clock.now() + 5 * MINUTE);
  const stored = await flowRecord(w, flow.flowId); assert.equal(JSON.stringify(stored).includes(first.code), false, 'C is never stored');
  assert.equal((await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other())).code, first.code);
  assert.equal((await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other())).code, first.code);
  await assert.rejects(w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other()), fault('invalid_link'), 'at most 3 reveals');
  assert.equal((await w.status(flow)).status, 'code');
  // The code without S, or S without the code, yields nothing.
  const wrongSecret = (await createFlowSecret()).secret;
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: wrongSecret, code: first.code, confirmed: true }, w.other()), fault('invalid_flow'));
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R()), fault('invalid_code'));
  const result = await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: `${first.code.slice(0, 3)} ${first.code.slice(3)}`, confirmed: true }, w.R());
  assert.equal(result.source, 'email-cross-device');
  const session = (await w.repository.get(alice.id)).sessions.at(-1); assert.equal(session.source, 'email-cross-device'); assert.equal(session.emailAddress, 'alice@mail.example');
});

test('codes: wrong codes count down and lock at 5; a code from another flow never works; expired codes end the flow (T10, T17)', async () => {
  const w = world(); await signInAccount(w);
  const a = await w.start('alice@mail.example'), b = await w.start('alice@mail.example');
  const codeA = (await w.act('emailLinkReveal', { t: a.token, confirmed: true }, w.other())).code;
  const codeB = (await w.act('emailLinkReveal', { t: b.token, confirmed: true }, w.other())).code;
  if (codeA !== codeB) await assert.rejects(w.act('emailFlowRedeem', { flowId: b.flowId, secret: b.secret, code: codeA, confirmed: true }, w.R()), fault('invalid_code'), 'cross-flow code');
  const wrong = code => String((Number(code) + 1) % 1e6).padStart(6, '0');
  const remaining = [];
  for (let i = 0; i < 3; i++) await assert.rejects(w.act('emailFlowRedeem', { flowId: a.flowId, secret: a.secret, code: wrong(codeA), confirmed: true }, w.R()), error => { remaining.push(error.remaining); return error.code === 'invalid_code'; });
  assert.deepEqual(remaining, [4, 3, 2]);
  await assert.rejects(w.act('emailFlowRedeem', { flowId: a.flowId, secret: a.secret, code: 'abc', confirmed: true }, w.R()), fault('invalid_code'));
  await assert.rejects(w.act('emailFlowRedeem', { flowId: a.flowId, secret: a.secret, code: wrong(codeA), confirmed: true }, w.R()), fault('flow_locked'));
  assert.equal((await w.status(a)).status, 'locked');
  await assert.rejects(w.act('emailFlowRedeem', { flowId: a.flowId, secret: a.secret, code: codeA, confirmed: true }, w.R()), fault('invalid_flow'), 'a locked flow never redeems, even with the right code');
  // Code expiry (5 minutes) inside the flow's life.
  w.clock.advance(5 * MINUTE);
  assert.equal((await w.status(b)).status, 'expired');
  await assert.rejects(w.act('emailFlowRedeem', { flowId: b.flowId, secret: b.secret, code: codeB, confirmed: true }, w.R()), fault('invalid_flow'));
  assert.equal((await flowRecord(w, b.flowId)).state, 'expired');
});

test('budgets: 20 failed code redemptions per network prefix per hour; the global budget then needs Turnstile (§4.7)', async () => {
  const w = world({ liveCaps: false }); await signInAccount(w);
  // Prefix budget: flows from many tabs on one /24.
  let refused = null;
  for (let i = 0; i < 25 && !refused; i++) {
    const flow = await w.start('alice@mail.example');
    await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other());
    try { await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: '000000', confirmed: true }, w.R()); } catch (error) { if (error.code === 'rate_limited') refused = i; }
  }
  assert.equal(refused, 20, 'the 21st code attempt from the prefix is refused');
  // Global budget: scaled to live codes with a floor; once spent, code redemptions need Turnstile.
  assert.equal(globalRedeemBudget(1), 100000); assert.equal(globalRedeemBudget(1e9), GLOBAL_REDEEM_FLOOR);
  const g = world(); await signInAccount(g);
  await g.engine.container.use(['identity'], ({ identity }) => { identity.emailFlow().liveCodes = async () => 1e9; });
  const one = await g.start('alice@mail.example'), two = await g.start('alice@mail.example');
  const c1 = (await g.act('emailLinkReveal', { t: one.token, confirmed: true }, g.other())).code, c2 = (await g.act('emailLinkReveal', { t: two.token, confirmed: true }, g.other())).code;
  assert.equal((await g.act('emailFlowRedeem', { flowId: one.flowId, secret: one.secret, code: c1, confirmed: true }, g.R())).source, 'email-cross-device', 'a correct code is never charged');
  await g.engine.container.use(['identity'], async ({ identity }) => { for (let i = 0; i < GLOBAL_REDEEM_FLOOR; i++) await identity.linkedLimits.consume('ef-g', { windowMs: 3600000, limit: GLOBAL_REDEEM_FLOOR }); });
  await assert.rejects(g.act('emailFlowRedeem', { flowId: two.flowId, secret: two.secret, code: c2, confirmed: true }, g.R()), fault('challenge_required'));
  assert.equal((await g.act('emailFlowRedeem', { flowId: two.flowId, secret: two.secret, code: c2, confirmed: true, turnstileToken: 'verified' }, g.R())).source, 'email-cross-device');
});

test('rate limits at start: 3 live flows per address and per browser marker; inspect 30 per 10 minutes per prefix; status slow_down', async () => {
  const w = world(); await signInAccount(w);
  for (let i = 0; i < 3; i++) await w.start('alice@mail.example', w.R({ emailBrowser: `${'C'.repeat(42)}${i}` }));
  await assert.rejects(w.start('alice@mail.example', w.R({ emailBrowser: 'D'.repeat(43) })), fault('rate_limited'));
  for (let i = 0; i < 3; i++) await w.start(`other${i}@mail.example`);
  await assert.rejects(w.start('other9@mail.example'), fault('rate_limited'), 'per browser');
  w.clock.advance(15 * MINUTE);
  const flow = await w.start('alice@mail.example');
  for (let i = 0; i < 30; i++) await w.act('emailLinkInspect', { t: 'z'.repeat(43) }, w.other());
  await assert.rejects(w.act('emailLinkInspect', { t: flow.token }, w.other()), fault('rate_limited'));
  w.clock.advance(EMAIL_FLOW.interval * 1000);
  assert.equal((await w.act('emailFlowStatus', { flowId: flow.flowId, secret: flow.secret }, w.R())).status, 'pending');
  assert.equal((await w.act('emailFlowStatus', { flowId: flow.flowId, secret: flow.secret }, w.R())).status, 'slow_down');
  // A wrong S or an unknown flow answers `expired`, never more.
  assert.equal((await w.status(flow, (await createFlowSecret()).secret)).status, 'expired');
  assert.equal((await w.act('emailFlowStatus', { flowId: 'A'.repeat(22), secret: flow.secret }, w.R())).status, 'expired');
});

test('BroadcastChannel wake-ups carry no authority: only this flow\'s tag is accepted, and a forged wake-up can at most cause one poll (T14)', async () => {
  const w = world(); await signInAccount(w);
  const flow = await w.start('alice@mail.example'), other = await w.start('alice@mail.example');
  const mine = { flowId: flow.flowId, channelTag: flow.channelTag };
  assert.equal(acceptWake(wakeMessage(mine), mine), true);
  for (const forged of [wakeMessage({ flowId: flow.flowId, channelTag: other.channelTag }), wakeMessage({ flowId: other.flowId, channelTag: flow.channelTag }), { ...wakeMessage(mine), v: 2 }, { ...wakeMessage(mine), type: 'redeemed' }, { ...wakeMessage(mine), tag: flow.channelTag.slice(1) }, null, 'approved', { v: 1, type: 'approved', flowId: flow.flowId }])
    assert.equal(acceptWake(forged, mine), false, JSON.stringify(forged));
  // Even an accepted (replayed) wake-up only polls: the flow is still pending and cannot be redeemed.
  assert.equal((await w.status(flow)).status, 'pending');
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R()), fault('invalid_flow'));
  // T is derived from S and checks out against what R sent.
  assert.equal((await flowProofs(flow.secret)).channelTag, flow.channelTag);
});

test('closed original tab, same browser: complete-here needs B, an approved flow and an explicit act; the intent is dropped (N8)', async () => {
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  await assert.rejects(w.act('emailLinkCompleteHere', { t: flow.token, confirmed: true }, w.H()), fault('invalid_link'), 'not before approval');
  await w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.H());
  assert.deepEqual(await w.act('emailLinkStatus', { t: flow.token }, w.H()), { state: 'approved' });
  assert.deepEqual(await w.act('emailLinkStatus', { t: flow.token }, w.other()), { state: 'gone' }, 'needs B');
  await assert.rejects(w.act('emailLinkCompleteHere', { t: flow.token, confirmed: true }, w.other()), fault('invalid_link'));
  await assert.rejects(w.act('emailLinkCompleteHere', { t: flow.token }, w.H()), fault('confirmation_required'));
  const result = await w.act('emailLinkCompleteHere', { t: flow.token, confirmed: true }, w.H());
  assert.equal(result.intentDropped, true); assert.equal(result.source, 'email'); assert.equal(result.account.id, alice.id);
  assert.deepEqual(await w.act('emailLinkStatus', { t: flow.token }, w.H()), { state: 'redeemed' });
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R()), fault('invalid_flow'), 'R can no longer redeem');
  assert.equal((await flowRecord(w, flow.flowId)).redeemedVia, 'complete-here');
  // A redeem by R first makes complete-here fail.
  const second = await w.start('alice@mail.example'); await w.act('emailLinkApprove', { t: second.token, confirmed: true }, w.H());
  await w.act('emailFlowRedeem', { flowId: second.flowId, secret: second.secret, confirmed: true }, w.R());
  await assert.rejects(w.act('emailLinkCompleteHere', { t: second.token, confirmed: true }, w.H()), fault('invalid_link'));
});

test('EL-6 rebinding at redemption: a security epoch change, sign-in turned off and on, or a suspended account fail generically (T17)', async () => {
  for (const change of ['epoch', 'signInSince', 'suspended', 'removed']) {
    const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
    await w.act('emailLinkApprove', { t: flow.token, confirmed: true }, w.H());
    const record = await w.repository.get(alice.id);
    if (change === 'epoch') record.security = { epoch: record.security.epoch + 1, changedAt: w.clock.now() };
    if (change === 'signInSince') record.emails[0].signInSince = w.clock.now();
    if (change === 'suspended') record.status = 'suspended';
    if (change === 'removed') record.emails[0] = { ...record.emails[0], state: 'verified' };
    if (change === 'removed') delete record.emails[0].signInSince;
    await w.repository.compareAndSwap(alice.id, record.revision, { ...record, revision: record.revision + 1 });
    const sessions = (await w.repository.get(alice.id)).sessions.length;
    await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R()), fault('invalid_flow'), change);
    assert.equal((await w.repository.get(alice.id)).sessions.length, sessions, `${change}: no session`);
    assert.equal((await flowRecord(w, flow.flowId)).outcome, 'rebind-failed');
  }
  // A real epoch change through the service: adding a passkey after the flow started.
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  const owner = sessionContext(await signInPasskey(w.act, 'alice', alice.credentialId));
  const begin = await w.act('credentialBegin', { label: 'Second' }, owner);
  await w.act('credentialFinish', { challengeId: begin.challengeId, response: passkeyResponse(begin, 'second-key') }, owner);
  const code = (await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other())).code;
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code, confirmed: true }, w.R()), fault('invalid_flow'));
});

test('cancel from the helper (with confirmation, notice for sign-in) and from the original tab; resend kills old links; expiry', async () => {
  const w = world(); await signInAccount(w);
  const a = await w.start('alice@mail.example');
  await assert.rejects(w.act('emailLinkCancel', { t: a.token }, w.other()), fault('confirmation_required'));
  assert.deepEqual(await w.act('emailLinkCancel', { t: a.token, confirmed: true }, w.other()), { cancelled: true });
  assert.equal((await w.status(a)).status, 'cancelled'); await w.settle();
  assert.equal(w.alerts.some(alert => alert.type === 'email-sign-in-cancelled'), true);
  await assert.rejects(w.act('emailLinkApprove', { t: a.token, confirmed: true }, w.H()), fault('invalid_link'));
  // R cancels.
  const b = await w.start('alice@mail.example');
  assert.deepEqual(await w.act('emailFlowCancel', { flowId: b.flowId, secret: b.secret }, w.R()), { cancelled: true });
  assert.deepEqual(await w.act('emailLinkInspect', { t: b.token }, w.H()), { invalid: true });
  // Resend: same flow, new link; the old link is dead; a revealed code is discarded.
  const c = await w.start('alice@mail.example');
  await w.act('emailLinkReveal', { t: c.token, confirmed: true }, w.other());
  const before = w.mail.length; await w.act('emailFlowResend', { flowId: c.flowId, secret: c.secret }, w.R()); await w.settle();
  const fresh = w.mail.slice(before).find(m => m.token).token; assert.notEqual(fresh, c.token);
  assert.deepEqual(await w.act('emailLinkInspect', { t: c.token }, w.H()), { invalid: true });
  assert.equal((await w.status(c)).status, 'pending');
  await w.act('emailLinkApprove', { t: fresh, confirmed: true }, w.H());
  assert.equal((await w.act('emailFlowRedeem', { flowId: c.flowId, secret: c.secret, confirmed: true }, w.R())).source, 'email');
  // Resend is capped at 3 per flow and needs S.
  w.clock.advance(15 * MINUTE);
  const d = await w.start('alice@mail.example');
  await assert.rejects(w.act('emailFlowResend', { flowId: d.flowId, secret: c.secret }, w.R()), fault('invalid_flow'));
  for (let i = 0; i < 3; i++) await w.act('emailFlowResend', { flowId: d.flowId, secret: d.secret }, w.R());
  await assert.rejects(w.act('emailFlowResend', { flowId: d.flowId, secret: d.secret }, w.R()), fault('rate_limited'));
  // The link lives 10 minutes, the flow 15.
  const e = await w.start('elsewhere@mail.example');
  w.clock.advance(15 * MINUTE);
  const f = await w.start('alice@mail.example');
  w.clock.advance(10 * MINUTE);
  assert.deepEqual(await w.act('emailLinkInspect', { t: f.token }, w.H()), { invalid: true });
  assert.equal((await w.status(f)).status, 'pending');
  w.clock.advance(5 * MINUTE);
  assert.equal((await w.status(f)).status, 'expired');
  void e;
});

test('scanner behaviour: inspect from a scanner changes nothing; a scanner reveal does not burn the link; a scanner never signs in (T2)', async () => {
  const w = world(), alice = await signInAccount(w), flow = await w.start('alice@mail.example');
  const scanner = w.other({ emailBrowser: undefined, remoteIP: '198.51.100.77' });
  for (let i = 0; i < 4; i++) assert.equal((await w.act('emailLinkInspect', { t: flow.token }, scanner)).purpose, 'sign-in');
  await assert.rejects(w.act('emailLinkApprove', { t: flow.token, confirmed: true }, scanner), fault('invalid_link'));
  await assert.rejects(w.act('emailLinkCompleteHere', { t: flow.token, confirmed: true }, scanner), fault('invalid_link'));
  const scanned = await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, scanner);
  // The user then opens the same link: the same code is shown, and only R (with S) can use it.
  const mine = await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other()); assert.equal(mine.code, scanned.code);
  await assert.rejects(w.act('emailFlowRedeem', { flowId: flow.flowId, secret: (await createFlowSecret()).secret, code: scanned.code, confirmed: true }, scanner), fault('invalid_flow'));
  assert.equal((await w.repository.get(alice.id)).sessions.filter(s => s.source?.startsWith('email')).length, 0);
});

test('sign-up: create-account link → original tab confirms terms and age → pending account with a sign-in email → recovery file without a passkey → activation (email session) and the passkey suggestion (§3.4)', async () => {
  const w = world(), flow = await w.start('New.Person@Mail.Example');
  const sent = w.mail.find(m => m.purpose === 'sign-up'); assert.equal(sent.email, 'New.Person@mail.example');
  const view = await w.act('emailLinkInspect', { t: sent.token }, w.H()); assert.deepEqual({ purpose: view.purpose, maskedAddress: view.maskedAddress }, { purpose: 'sign-up', maskedAddress: maskAddress('New.Person@mail.example') });
  await w.act('emailLinkApprove', { t: sent.token, confirmed: true }, w.H());
  const redeemed = await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R());
  assert.equal(redeemed.sessionToken, undefined, 'sign-up redemption creates no session'); assert.match(redeemed.signup.signupToken, /^es1\./); assert.equal(redeemed.signup.crossDevice, false);
  const confirm = input => w.act('emailSignupConfirm', { signupToken: redeemed.signup.signupToken, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle: 'newperson', ...input }, w.R());
  await assert.rejects(confirm({ termsAccepted: false }), fault('terms_required'));
  await assert.rejects(confirm({ ageConfirmed: undefined }), fault('age_confirmation_required'));
  const pending = await confirm();
  assert.equal(pending.account.status, 'pending'); assert.equal(pending.credentialRequired, false); assert.deepEqual(pending.account.emails.map(e => [e.address, e.state]), [['New.Person@mail.example', 'sign-in']]);
  await assert.rejects(confirm(), fault('invalid_flow'), 'the binding is single use');
  const file = await w.act('downloadRecovery', { pendingToken: pending.pendingToken }, w.R());
  const active = await w.act('confirmRecovery', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true }, w.R());
  assert.equal(active.account.status, 'active');
  const record = await w.repository.get(pending.account.id); assert.equal(record.sessions.at(-1).source, 'email'); assert.equal(record.emailSignup, undefined);
  assert.deepEqual(active.account.hostItems.map(item => [item.id, item.kind, item.repeat]), [['passkey-suggestion', 'system', false]]);
  const owner = sessionContext(active);
  // "Not now" hides it until its one repeat (30 days after admission).
  await assert.rejects(w.act('dismissHostItem', { id: 'other' }, owner), fault('invalid_request'));
  assert.equal((await w.act('dismissHostItem', { id: 'passkey-suggestion' }, owner)).account.hostItems, undefined);
  assert.equal((await w.repository.get(pending.account.id)).passkeySuggestion.dismissedAt, w.clock.now());
  // The email session may add a passkey (SI-4), which ends the suggestion for good.
  const begin = await w.act('credentialBegin', { label: 'Laptop' }, owner);
  await w.act('credentialFinish', { challengeId: begin.challengeId, response: passkeyResponse(begin, 'pk-new') }, owner);
  assert.equal((await w.owner(owner)).account.hostItems, undefined);
  const added = (await w.repository.get(pending.account.id)).credentials[0]; assert.equal(added.addedBy.session, 'email'); assert.equal(added.provisionalUntil, undefined);
});

test('passkey suggestion: informational, dismissible, repeats at most once after 30 days, gone once a passkey exists', () => {
  const at = Date.UTC(2026, 9, 1), account = { credentials: [], passkeySuggestion: { admittedAt: at } };
  assert.equal(hostItems(account, at + DAY)[0].repeat, false);
  const dismissed = { ...account, passkeySuggestion: { admittedAt: at, dismissedAt: at + DAY } };
  assert.deepEqual(hostItems(dismissed, at + 2 * DAY), []);
  const repeat = hostItems(dismissed, at + PASSKEY_SUGGESTION_REPEAT_MS); assert.equal(repeat.length, 1); assert.equal(repeat[0].repeat, true); assert.equal(repeat[0].admittedAt, at + PASSKEY_SUGGESTION_REPEAT_MS);
  assert.deepEqual(hostItems({ ...account, passkeySuggestion: { admittedAt: at, dismissedAt: at + PASSKEY_SUGGESTION_REPEAT_MS + 1 } }, at + 365 * DAY), [], 'never a third time');
  assert.deepEqual(hostItems({ ...account, credentials: [{ id: 'x' }] }, at + DAY), []);
});

test('sign-up via a code from another device: the account opens with an email-cross-device session; N2 limits apply', async () => {
  const w = world(), flow = await w.start('tv@mail.example');
  const code = (await w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other())).code;
  const redeemed = await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code, confirmed: true }, w.R());
  assert.equal(redeemed.signup.crossDevice, true);
  const pending = await w.act('emailSignupConfirm', { signupToken: redeemed.signup.signupToken, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle: 'tvuser' }, w.R());
  const file = await w.act('downloadRecovery', { pendingToken: pending.pendingToken }, w.R());
  const active = await w.act('confirmRecovery', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true }, w.R());
  const id = pending.account.id, owner = sessionContext(active);
  assert.equal((await w.repository.get(id)).sessions.at(-1).source, 'email-cross-device');
  // N2: turning sign-in on for another address is refused from such a session.
  const record = await w.repository.get(id); record.emails.push({ address: 'second@mail.example', state: 'verified', verifiedAt: w.clock.now(), notices: false, source: 'linked', addedBy: { session: 'email-cross-device', at: w.clock.now() } });
  await w.repository.compareAndSwap(id, record.revision, { ...record, revision: record.revision + 1 });
  await assert.rejects(w.act('configureEmailLogin', { address: 'second@mail.example', enabled: true }, owner), fault('step_up_required'));
  // It may add a passkey, which is provisional for 24 h: it signs in but cannot satisfy LA-7.
  const begin = await w.act('credentialBegin', { label: 'TV' }, owner);
  await w.act('credentialFinish', { challengeId: begin.challengeId, response: passkeyResponse(begin, 'pk-tv') }, owner);
  const credential = (await w.repository.get(id)).credentials[0];
  assert.equal(credential.addedBy.session, 'email-cross-device'); assert.equal(credential.provisionalUntil, w.clock.now() + DAY);
  const signedIn = await signInPasskey(w.act, 'tvuser', 'pk-tv');
  const after = await w.repository.get(id), session = after.sessions.at(-1);
  const freshness = await w.engine.container.use(['identity'], ({ identity }) => [identity.authAt(session), identity.approvalAuthAt(after, session)]);
  assert.equal(freshness[0], w.clock.now()); assert.equal(freshness[1], -Infinity, 'a provisional passkey proves nothing for LA-7');
  assert.equal((await w.owner(sessionContext(signedIn))).credentials[0].provisionalUntil, credential.provisionalUntil);
  w.clock.advance(DAY);
  const later = await signInPasskey(w.act, 'tvuser', 'pk-tv'), record2 = await w.repository.get(id);
  const fresh = await w.engine.container.use(['identity'], ({ identity }) => identity.approvalAuthAt(record2, record2.sessions.at(-1)));
  assert.equal(fresh, w.clock.now(), 'after 24 hours it counts'); void later;
  // A same-browser email session on the same account may turn sign-in on (SI-4), unlike the cross-device one.
});

test('sign-up races: two redeemed create-account links for one address create one account; an abandoned sign-up releases the address', async () => {
  const w = world();
  const flows = [await w.start('race@mail.example'), await w.start('race@mail.example', w.R({ emailBrowser: 'E'.repeat(43) }))];
  const tokens = [];
  for (const [index, flow] of flows.entries()) {
    const ctx = index ? w.H({ emailBrowser: 'E'.repeat(43) }) : w.H(); await w.act('emailLinkApprove', { t: flow.token, confirmed: true }, ctx);
    tokens.push((await w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R())).signup.signupToken);
  }
  const results = await concurrently(tokens.map((signupToken, i) => () => w.act('emailSignupConfirm', { signupToken, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle: `racer${i}` }, w.R())));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(results.map(r => r.reason?.code)));
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'email_already_linked');
  // While that sign-up is still within its setup window, a new start for the address is inert (nothing mailed).
  w.clock.advance(15 * MINUTE + 1);
  const during = await w.start('race@mail.example'); assert.equal(during.token, undefined); assert.equal((await flowRecord(w, during.flowId)).purpose, 'inert');
  // After the setup window the sign-up is abandoned: a new create-account link is mailed and confirming releases the old claim.
  w.clock.advance(31 * MINUTE);
  const again = await w.start('race@mail.example'); assert.match(again.token, /^[A-Za-z0-9_-]{43}$/);
  await w.act('emailLinkApprove', { t: again.token, confirmed: true }, w.H());
  const token = (await w.act('emailFlowRedeem', { flowId: again.flowId, secret: again.secret, confirmed: true }, w.R())).signup.signupToken;
  const created = await w.act('emailSignupConfirm', { signupToken: token, termsAccepted: true, termsVersion: config.termsVersion, ageConfirmed: 18, handle: 'racer9' }, w.R());
  assert.equal(created.account.emails[0].address, 'race@mail.example');
});

test('requester summary: a fixed vocabulary from the User-Agent and coarse geo; never the raw string or an IP', () => {
  assert.deepEqual(requesterSummary({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', city: 'Berlin', region: 'Berlin', country: 'DE' }), { uaSummary: { browser: 'Chrome', system: 'Windows' }, approxLocation: { city: 'Berlin', region: 'Berlin', country: 'DE' } });
  assert.deepEqual(requesterSummary({ userAgent: '<script>alert(1)</script>', city: '<b>evil</b>', country: 'XX' }), { uaSummary: { browser: null, system: null }, approxLocation: null });
  assert.deepEqual(requesterSummary({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }).uaSummary, { browser: 'Safari', system: 'iOS' });
});

test('seeded chaos: concurrent flows with interleaved approve, reveal, redeem, cancel, resend, status and expiry keep every invariant', async () => {
  await forEachSeed(12, async random => {
    const w = world({ liveCaps: false }); const alice = await signInAccount(w), flows = [];
    for (let i = 0; i < 6; i++) { const ctx = w.R({ emailBrowser: `${'F'.repeat(41)}${String(i).padStart(2, '0')}` }); flows.push({ ...await w.start('alice@mail.example', ctx), browser: ctx.emailBrowser, codes: [] }); }
    const op = flow => {
      const choice = random.int(9);
      const H = w.H({ emailBrowser: flow.browser });
      if (choice === 0) return w.act('emailLinkApprove', { t: flow.token, confirmed: true }, H);
      if (choice === 1) return w.act('emailLinkReveal', { t: flow.token, confirmed: true }, w.other()).then(r => { flow.codes.push(r.code); return r; });
      if (choice === 2) return w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, confirmed: true }, w.R());
      if (choice === 3) return w.act('emailFlowRedeem', { flowId: flow.flowId, secret: flow.secret, code: flow.codes.at(-1) ?? '123456', confirmed: true }, w.R());
      if (choice === 4) return w.act('emailFlowCancel', { flowId: flow.flowId, secret: flow.secret }, w.R());
      if (choice === 5) return w.act('emailLinkCancel', { t: flow.token, confirmed: true }, w.other());
      if (choice === 6) return w.act('emailFlowResend', { flowId: flow.flowId, secret: flow.secret }, w.R()).then(async r => { await w.settle(); const latest = w.mail.filter(m => m.token).at(-1); if (latest) flow.token = latest.token; return r; });
      if (choice === 7) return w.act('emailLinkCompleteHere', { t: flow.token, confirmed: true }, H);
      w.clock.advance(random.int(4) * MINUTE); return w.act('emailFlowStatus', { flowId: flow.flowId, secret: flow.secret }, w.R());
    };
    for (let round = 0; round < 8; round++) await concurrently(Array.from({ length: 8 }, () => () => op(random.pick(flows))));
    await w.settle();
    const account = await w.repository.get(alice.id), emailSessions = account.sessions.filter(s => s.source === 'email' || s.source === 'email-cross-device');
    let redeemed = 0;
    for (const flow of flows) {
      const record = await flowRecord(w, flow.flowId);
      assert.ok(['pending', 'approved-same-browser', 'code-revealed', 'redeemed', 'cancelled', 'locked', 'expired'].includes(record.state), record.state);
      assert.ok(record.codeAttempts <= EMAIL_FLOW.codeAttempts); assert.ok(record.reveals <= EMAIL_FLOW.reveals); assert.ok(record.resends <= EMAIL_FLOW.resends);
      if (record.state === 'redeemed') { redeemed++; assert.ok(['same-browser', 'code', 'complete-here'].includes(record.redeemedVia)); }
      if (record.state === 'locked') assert.equal(record.codeAttempts, EMAIL_FLOW.codeAttempts);
    }
    assert.equal(emailSessions.length, redeemed, 'exactly one session per redeemed flow, none otherwise');
  });
});
