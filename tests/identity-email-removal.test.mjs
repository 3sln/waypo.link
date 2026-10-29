// DX-6 email removal (docs/architecture/account-deletion-export.md §3, §8.3): identity.email-remove behind
// EMAIL_REMOVAL_ENABLED, step-up, the last-notice-channel rule and its waiver, index release in the same identity
// write, stale sharded lookups, concurrent change/removal, and the lifecycle channel revision. Engine level, over
// the in-memory, Node (SQLite IdentityRepository) and Worker (ShardedIdentityRepository) repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, MemoryAccounts, MemoryMetadata, memoryShards, signupInput, sessionContext, passkeyResponse, stepUpPasskey, signInPasskey } from './helpers/identity-engine.mjs';
import { noticeEmail, accountEmails, signInEmails } from '../packages/identity/emails.mjs';
import { fakeClock, forEachSeed, createScheduler, injectFaults } from './helpers/chaos.mjs';
import { identitySecurityPort } from '../packages/identity/service.mjs';
import { createFlags } from '../packages/flags/evaluate.mjs';
import { IdentityRepository, AccountController } from '../packages/runtime/accounts.mjs';
import { SqliteMetadata, SerialGate } from '../apps/node/resources.mjs';
import { accountChannelState, accountSecurityNotice, accountChannelsPort } from '../packages/runtime/account-channels.mjs';
import { lifecycleIdentityPort } from '../packages/identity/lifecycle-tombstone.mjs';

const MINUTE = 60000, DAY = 86400000, OLD = 'old@mail.example', NEW = 'new@mail.example';
const REPOSITORIES = ['memory', 'node', 'worker'];
const ON = { for: () => ({ enabled: name => name === 'EMAIL_REMOVAL_ENABLED' }) };
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth = Buffer.alloc(16, 9).toString('base64url');

function repositoryFor(kind, t, clock, { wrapShard } = {}) {
  if (kind === 'memory') return { repository: new MemoryAccounts() };
  if (kind === 'node') { const metadata = new SqliteMetadata(':memory:'); t.after(() => metadata.close()); return { repository: new IdentityRepository({ metadata, config: {} }), metadata }; }
  const shards = memoryShards(wrapShard ? { wrap: wrapShard } : {}); return { repository: shards.repository(clock.now), shards };
}
/** Channel port double: `ready` decides whether another notice channel exists. */
function channels({ ready = false, fail = false } = {}) {
  const notices = [];
  return { notices, set ready(value) { ready = value; }, state: async owner => { if (fail) throw new Error('account unavailable'); return { ready, count: ready ? 1 : 0, revision: ready ? 'p1-1' : 'p1-0', owner }; }, notify: async (owner, event) => { notices.push({ owner, event }); return { accepted: 1 }; } };
}
function harness(t, kind = 'memory', { clock = fakeClock(), flags = ON, accountChannels = channels(), wrap = r => r, wrapShard, ...overrides } = {}) {
  const store = repositoryFor(kind, t, clock, { wrapShard }), alerts = [];
  const h = identityEngine({ repository: wrap(store.repository), clock, flags, accountChannels, ...overrides });
  // identityEngine's default mailer records verification mail; add the security alert transport.
  h.resources.mailer.sendSecurityAlert = async value => { alerts.push(value); return { messageId: 'alert-' + alerts.length }; };
  return { ...h, ...store, accountChannels, alerts, record: id => store.repository.get(id), security: id => identitySecurityPort(store.repository)(id) };
}
const mailToken = (h, purpose) => h.mail.filter(m => m.purpose === purpose).at(-1).token;
async function activeAccount(h, input = signupInput()) {
  const pending = await h.act('signup', input); await h.act('registerPasskey', { pendingToken: pending.pendingToken, response: passkeyResponse(pending, KEY) });
  const file = await h.act('downloadRecovery', pending);
  const owner = await h.act('confirmRecovery', { ...pending, recoveryToken: file.recoveryToken, downloadConfirmed: true });
  const ctx = sessionContext(owner); await stepUpPasskey(h.act, ctx, KEY);
  return { id: pending.account.id, handle: pending.account.handle, ctx };
}
async function withEmail(h, email = OLD, input) {
  const account = await activeAccount(h, input);
  await h.act('emailStart', { email }, account.ctx); await h.service.settleBackground(); await h.act('emailConfirm', { token: mailToken(h, 'link'), confirmed: true }, account.ctx);
  return account;
}
// Every test account's passkey (credential ids are per account). Passwords were dropped (2026-10-28).
const KEY = 'owner-passkey', step = (h, ctx) => stepUpPasskey(h.act, ctx, KEY);
/** The notice address of a stored record (legacy fields or the emails model). */
const notice = record => noticeEmail(record);
const remove = (h, input, ctx) => h.service.emailRemove(input, ctx);
const unchanged = async (h, id, before) => { const after = await h.record(id); assert.deepEqual(accountEmails(after), accountEmails(before)); assert.deepEqual(after.security, before.security); assert.equal(after.noticeWaiver, before.noticeWaiver); };
const shardRows = (shards, prefix) => [...shards.controllers.values()].flatMap(c => [...c.metadata.rows].filter(([key]) => key.startsWith(prefix)));

test('EMAIL_REMOVAL_ENABLED: off without a flags port, when the port says off, and with the real evaluator before any rollout', async t => {
  // The registry row (DX-1) defaults safe:false; the env kill also keeps it off. Before the row exists the
  // evaluator throws unknown_flag, which the service treats as off.
  const real = createFlags({ snapshot: { v: 1, version: 0, issuedAt: 0, flags: {} }, env: {} }), killed = createFlags({ snapshot: { v: 1, version: 0, issuedAt: 0, flags: {} }, env: { EMAIL_REMOVAL_ENABLED: 'false' } });
  for (const flags of [null, { for: () => ({ enabled: () => false }) }, () => ({ for: () => ({ enabled: () => false }) }), real, killed, { for: () => { throw new Error('flags unavailable'); } }]) {
    const h = harness(t, 'memory', { flags }), { id, ctx } = await withEmail(h), before = await h.record(id);
    await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'email_removal_unavailable', status: 404 });
    await unchanged(h, id, before);
  }
  // A thunk is read per call, so a cached service follows the current snapshot.
  let on = false; const h = harness(t, 'memory', { flags: () => ({ for: ctx => ({ enabled: name => on && name === 'EMAIL_REMOVAL_ENABLED' && ctx.subject.kind === 'account' }) }) }), { ctx } = await withEmail(h);
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'email_removal_unavailable' });
  on = true; assert.equal((await remove(h, { confirmed: true, waiveNotice: true }, ctx)).removed, true);
});

test('authority: origin, CSRF, a fresh step-up, explicit confirmation and an exact input shape', async t => {
  const h = harness(t), { id, ctx } = await withEmail(h), before = await h.record(id);
  await assert.rejects(remove(h, { confirmed: true }, { ...ctx, origin: 'https://evil.example' }), { code: 'csrf' });
  await assert.rejects(remove(h, { confirmed: true }, { ...ctx, csrfToken: 'wrong' }), { code: 'csrf' });
  await assert.rejects(remove(h, { confirmed: true }, { ...ctx, sessionToken: undefined }), { code: 'unauthorized' });
  h.clock.advance(5 * MINUTE);
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'step_up_required' }, 'a five-minute-old step-up is not enough');
  await step(h, ctx);
  for (const input of [{}, { confirmed: 'true' }, { confirmed: false }]) await assert.rejects(remove(h, input, ctx), { code: 'confirmation_required' });
  for (const input of [{ confirmed: true, email: OLD }, { confirmed: true, waiveNotice: 'yes' }, null]) await assert.rejects(remove(h, input, ctx), { code: 'invalid_request' });
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: true, expectedEmail: 'other@mail.example' }, ctx), { code: 'email_changed', status: 409 });
  await unchanged(h, id, before);
  // A session that only signed in recently (no step-up) cannot remove the email.
  const fresh = sessionContext(await signInPasskey(h.act, (await h.record(id)).handle, KEY));
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, fresh), { code: 'step_up_required' });
  const noEmail = harness(t), plain = await activeAccount(noEmail);
  await assert.rejects(remove(noEmail, { confirmed: true, waiveNotice: true }, plain.ctx), { code: 'email_not_linked', status: 409 });
});

test('last notice channel: refused without a waiver; the waiver is recorded, email sign-in and links for the address die, a notice goes to the removed address', async t => {
  const h = harness(t, 'memory', { accountChannels: undefined }), { id, ctx } = await withEmail(h);
  await h.act('configureEmailLogin', { enabled: true }, ctx);
  // Removing a recent sign-in email needs a passkey enrolled 7 days or more earlier (removal process RM-2, 2026-10-28).
  { const record = await h.record(id); record.credentials[0].createdAt = h.clock.now() - 8 * DAY; h.repository.records.set(id, record); }
  await h.act('emailLoginStart', { email: OLD, turnstileToken: 'verified' }); await h.service.settleBackground(); const loginLink = mailToken(h, 'login');
  await h.act('emailStart', { email: NEW }, ctx); const pendingLink = mailToken(h, 'link');
  const before = await h.record(id);
  await assert.rejects(remove(h, { confirmed: true }, ctx), { code: 'last_notice_channel', status: 409 });
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: false }, ctx), { code: 'last_notice_channel' });
  await unchanged(h, id, before); assert.equal((await h.repository.findByEmail(OLD))?.id, id);
  h.clock.advance(1000);
  const result = await remove(h, { confirmed: true, waiveNotice: true, expectedEmail: OLD }, ctx);
  assert.deepEqual({ removed: result.removed, noticeWaived: result.noticeWaived, email: result.account.noticeEmail, login: result.account.signInEmail }, { removed: true, noticeWaived: true, email: null, login: false });
  const after = await h.record(id);
  assert.deepEqual(after.noticeWaiver, { at: h.clock.now(), termsVersion: h.resources.config.termsVersion });
  assert.deepEqual([notice(after), accountEmails(after).filter(entry => entry.state !== 'unverified'), after.emailChallenges.filter(c => c.email === OLD)], [null, [], []]);
  assert.equal(after.audit.at(-1).type, 'email-removed');
  assert.deepEqual(after.security, { epoch: before.security.epoch + 1, changedAt: h.clock.now() });
  assert.deepEqual(after.credentials.map(c => c.id), before.credentials.map(c => c.id), 'credentials are untouched'); assert.equal(after.recoveryHash, before.recoveryHash, 'recovery is untouched');
  assert.equal((await h.repository.findByEmail(OLD)) ?? null, null);
  await assert.rejects(h.act('emailLoginConfirm', { token: loginLink, confirmed: true }), { code: 'unauthorized' }, 'outstanding login links fail');
  assert.deepEqual(after.emailChallenges.filter(c => c.email === OLD), [], 'every link for the removed address is gone');
  // Turning sign-in on and the removal's end of sign-in are notices too (2026-10-28), then the removal alert itself.
  assert.deepEqual(h.alerts, ['email-sign-in-enabled', 'email-sign-in-removed', 'email-removed'].map(type => ({ email: OLD, type, owner: id })));
  assert.deepEqual(result.notified, { email: true, push: false });
  await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'email_not_linked' }, 'a replay changes nothing');
  // An unverified address added before the removal is a separate entry (2026-10-28), so its link still verifies it;
  // verifying an address again ends the waiver: a later removal must waive again.
  await h.act('emailConfirm', { token: pendingLink, confirmed: true }, ctx);
  assert.equal((await h.record(id)).noticeWaiver, undefined); assert.equal(notice(await h.record(id)), NEW);
});

test('waiver rules: needs current terms; never recorded when push remains; an unreadable channel state refuses even with a waiver', async t => {
  {
    const h = harness(t), { id, ctx } = await withEmail(h), record = await h.record(id);
    record.termsVersion = 'superseded'; record.revision++; h.repository.records.set(id, record);
    const before = await h.record(id);
    await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'terms_acceptance_required', status: 403 });
    await unchanged(h, id, before);
    // With another channel, removal stays available during terms re-acceptance (termsGate exempt).
    h.accountChannels.ready = true;
    assert.equal((await remove(h, { confirmed: true }, ctx)).noticeWaived, false);
  }
  {
    const h = harness(t, 'memory', { accountChannels: channels({ ready: true }) }), { id, ctx } = await withEmail(h);
    const result = await remove(h, { confirmed: true, waiveNotice: true }, ctx);
    assert.equal(result.noticeWaived, false); assert.equal((await h.record(id)).noticeWaiver, undefined, 'an unneeded waiver is not recorded');
    assert.deepEqual(h.accountChannels.notices, [{ owner: id, event: 'email-removed' }]); assert.deepEqual(result.notified, { email: true, push: true });
  }
  for (const accountChannels of [channels({ fail: true }), { state: async () => ({ ready: true, count: 0, revision: 'x' }) }, { state: async () => ({ ready: 'yes', count: 1 }) }, { state: async () => null }]) {
    const h = harness(t, 'memory', { accountChannels }), { id, ctx } = await withEmail(h), before = await h.record(id);
    await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'notice_channels_unavailable', status: 503 });
    await unchanged(h, id, before);
  }
  {
    // Notice transports failing after commit never undo or fail the removal.
    const h = harness(t, 'memory', { accountChannels: { state: async () => ({ ready: true, count: 1, revision: 'p' }), notify: async () => { throw new Error('push down'); } } }), { id, ctx } = await withEmail(h);
    h.resources.mailer.sendSecurityAlert = async () => { throw new Error('mail down'); };
    const result = await remove(h, { confirmed: true }, ctx);
    assert.deepEqual(result.notified, { email: false, push: false }); assert.equal(notice(await h.record(id)), null);
  }
});

test('index release: Node removes email/<addr> in the same transaction; another account can verify the address', async t => {
  const h = harness(t, 'node'), { id, ctx } = await withEmail(h);
  assert.equal(await h.metadata.get(`email/${OLD}`), id);
  await remove(h, { confirmed: true, waiveNotice: true }, ctx);
  assert.equal(await h.metadata.get(`email/${OLD}`), undefined);
  assert.equal((await h.repository.findByEmail(OLD)) ?? null, null);
  const other = await withEmail(h, OLD, signupInput({ handle: 'carol' }));
  assert.equal((await h.repository.findByEmail(OLD)).id, other.id);
});

test('index release: Worker shards release the lookup claim; stale lookups after a crash at either phase never resolve and are reclaimable', async t => {
  // Clean removal: prepare/commit drops the email link and releases identity-lookup/email/<addr>.
  {
    const h = harness(t, 'worker'), { id, ctx } = await withEmail(h);
    assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 1);
    await remove(h, { confirmed: true, waiveNotice: true }, ctx);
    assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 0);
  }
  for (const phase of ['settle', 'release']) {
    let armed = false;
    const method = phase === 'settle' ? 'shardSettle' : 'shardRelease';
    const h = harness(t, 'worker', { wrapShard: stub => injectFaults(stub, [{ method, when: call => armed && (phase === 'settle' || call.args[0] === 'email') && !(armed = false), mode: 'throw' }]) });
    const { id, ctx } = await withEmail(h), epoch = (await h.security(id)).epoch;
    armed = true;
    await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'injected_fault' }, `crash at ${phase}`);
    // The claim may still exist, but it never resolves to the account.
    assert.equal((await h.repository.findByEmail(OLD)) ?? null, null, `${phase}: stale lookup resolved`);
    const after = await h.record(id);
    assert.equal(notice(after), null, `${phase}: the identity write settles to the removal`);
    assert.equal((await h.security(id)).epoch, epoch + 1, `${phase}: exactly one bump`);
    assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 0, `${phase}: the stale claim was released`);
    const other = await withEmail(h, OLD, signupInput({ handle: 'carol' }));
    assert.equal((await h.repository.findByEmail(OLD)).id, other.id, `${phase}: another account reclaimed the address`);
    await assert.rejects(remove(h, { confirmed: true, waiveNotice: true }, ctx), { code: 'email_not_linked' }, `${phase}: the client retry is a no-op`);
  }
});

test('Worker shards: a stale lookup row that survives a crash is never resolved and another account reclaims it', async t => {
  const h = harness(t, 'worker'), { id, ctx } = await withEmail(h);
  const [[, claim]] = shardRows(h.shards, `identity-lookup/email/${OLD}`);
  await remove(h, { confirmed: true, waiveNotice: true }, ctx);
  // Put the released claim back, exactly as a crash between commit and release would have left it, in the shard
  // the repository routes the address to.
  await (await h.repository.bucket('email', OLD)).shardClaim('email', OLD, claim);
  assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 1);
  assert.equal((await h.repository.findByEmail(OLD)) ?? null, null);
  assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 0, 'the stale claim is released on sight');
  await (await h.repository.bucket('email', OLD)).shardClaim('email', OLD, claim);
  const other = await withEmail(h, OLD, signupInput({ handle: 'carol' }));
  assert.equal((await h.repository.findByEmail(OLD)).id, other.id, 'verification by another account reclaims the stale claim');
  assert.notEqual(other.id, id);
});

test('seeded chaos: lookups racing a sharded removal only ever resolve an account that still holds the address', async t => forEachSeed(30, async random => {
  const scheduler = createScheduler(random), h = harness(t, 'worker', { wrapShard: (stub, name) => scheduler.wrap(stub, name) });
  const { id, ctx } = await withEmail(h);
  const results = await scheduler.run([() => remove(h, { confirmed: true, waiveNotice: true }, ctx), () => h.repository.findByEmail(OLD), () => h.repository.findByEmail(OLD), () => h.repository.findByEmail(OLD)]);
  assert.equal(results[0].status, 'fulfilled', results[0].reason?.stack);
  for (const r of results.slice(1)) { assert.equal(r.status, 'fulfilled', r.reason?.stack); if (r.value) { assert.equal(r.value.id, id); assert.equal(notice(r.value), OLD, 'a resolved lookup always names a record that holds the address'); } }
  assert.equal((await h.repository.findByEmail(OLD)) ?? null, null);
  assert.equal(shardRows(h.shards, `identity-lookup/email/${OLD}`).length, 0);
}));

for (const kind of REPOSITORIES) {
  test(`${kind}: seeded chaos — concurrent email addition and removal linearize; index, epoch and challenges stay consistent`, async t => forEachSeed(kind === 'memory' ? 60 : 20, async random => {
    const scheduler = createScheduler(random), guarded = random.chance(0.5);
    const h = harness(t, kind, { wrap: repository => scheduler.wrap(repository, 'identity'), accountChannels: channels({ ready: random.chance(0.5) }) });
    const { id, ctx } = await withEmail(h);
    await h.act('emailStart', { email: NEW }, ctx); const token = mailToken(h, 'link');
    await step(h, ctx);
    const initial = (await h.security(id)).epoch;
    const results = await scheduler.run([
      () => h.act('emailConfirm', { token, confirmed: true }, ctx),
      () => remove(h, { confirmed: true, waiveNotice: true, ...guarded ? { expectedEmail: OLD } : {} }, ctx),
      () => h.owner(ctx),
    ]);
    const [confirm, removal] = results, label = `guarded=${guarded} ${results.map(r => r.status === 'fulfilled' ? 'ok' : r.reason.code).join(',')}\n${scheduler.trace.join('\n')}`;
    for (const r of results) if (r.status === 'rejected') assert(['conflict', 'email_changed', 'invalid_challenge'].includes(r.reason.code), `${r.reason.stack}\n${label}`);
    const record = await h.record(id), confirmed = confirm.status === 'fulfilled', removed = removal.status === 'fulfilled';
    // Confirming a second address adds it beside the first (2026-10-28); the removal names the notice address OLD
    // (explicitly when guarded), so it never removes NEW and the two commute.
    const held = address => address === OLD ? !removed : confirmed, owned = address => accountEmails(record).some(entry => entry.address === address && entry.state !== 'unverified');
    for (const address of [OLD, NEW]) assert.equal(owned(address), held(address), `${address} held\n${label}`);
    assert.equal(notice(record), removed ? confirmed ? NEW : null : OLD, label);
    assert.equal((await h.security(id)).epoch, initial + Number(confirmed) + Number(removed), label);
    assert.equal(signInEmails(record).length, 0);
    if (removed) assert.deepEqual(record.emailChallenges.filter(c => c.email === OLD), []);
    const final = address => held(address);
    for (const address of [OLD, NEW]) assert.equal((await h.repository.findByEmail(address))?.id ?? null, final(address) ? id : null, `${address} index\n${label}`);
    if (kind === 'node') for (const address of [OLD, NEW]) assert.equal(await h.metadata.get(`email/${address}`), final(address) ? id : undefined, `raw ${address}`);
    if (kind === 'worker') for (const address of [OLD, NEW]) assert.equal(shardRows(h.shards, `identity-lookup/email/${address}`).length, final(address) ? 1 : 0, `claim ${address}\n${label}`);
  }));
}

// Account side: the channel port over the account's own push-subscription rows, Node SQLite and DO-shaped storage.
for (const [label, make] of [['node sqlite', t => { const db = new SqliteMetadata(':memory:'); t.after(() => db.close()); return db; }], ['worker storage', () => new MemoryMetadata()]]) {
  test(`account channels (${label}): lifecycle contactReady over stored push subscriptions; foreign rows ignored; revision tracks the set`, async t => {
    const metadata = make(t), owner = crypto.randomUUID(), other = crypto.randomUUID(), sent = [];
    const push = { send: async (subscription, payload) => { if (subscription.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { status: 410 }); sent.push({ endpoint: subscription.endpoint, payload }); return { accepted: true }; } };
    const empty = await accountChannelState(metadata, owner, { push });
    assert.deepEqual({ ...empty }, { owner, ready: false, count: 0, revision: empty.revision }); assert(Object.isFrozen(empty));
    await metadata.put(`push-subscription/${other}/x`, { id: 'x', owner: other, endpoint: 'https://fcm.googleapis.com/fcm/send/other', keys: { p256dh, auth } });
    assert.equal((await accountChannelState(metadata, owner, { push })).ready, false, 'another owner\'s device is not a channel');
    await metadata.put(`push-subscription/${owner}/a`, { id: 'a', owner, endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh, auth } });
    const one = await accountChannelState(metadata, owner, { push });
    assert.equal(one.ready, true); assert.equal(one.count, 1); assert.notEqual(one.revision, empty.revision);
    assert.equal((await accountChannelState(metadata, owner, {})).ready, false, 'no transport, no channel');
    await metadata.put(`push-subscription/${owner}/b`, { id: 'b', owner, endpoint: 'https://fcm.googleapis.com/fcm/send/gone', keys: { p256dh, auth } });
    const two = await accountChannelState(metadata, owner, { push }); assert.equal(two.count, 2); assert.notEqual(two.revision, one.revision);
    assert.deepEqual(await accountSecurityNotice(metadata, owner, { push, event: 'email-removed' }), { accepted: 1 }, 'a gone endpoint never blocks the others');
    assert.deepEqual(sent, [{ endpoint: 'https://fcm.googleapis.com/fcm/send/a', payload: { type: 'bindle-security-notice', owner, event: 'email-removed', path: `/console?account=${owner}&security=review` } }]);
    assert.deepEqual(await accountSecurityNotice(metadata, owner, { event: 'email-removed' }), { accepted: 0 });
    await assert.rejects(accountSecurityNotice(metadata, owner, { push, event: 'anything' }), TypeError);
    await assert.rejects(accountChannelState(metadata, 'not-a-uuid', { push }), TypeError);
  });
}

test('identity-side channel port: account faults and malformed state throw (fail closed); notify validates the event', async () => {
  const owner = crypto.randomUUID();
  const port = result => accountChannelsPort(async (target, method, args) => typeof result === 'function' ? result(target, method, args) : result);
  assert.deepEqual({ ...await port({ owner, ready: true, count: 1, revision: 'r' }).state(owner) }, { ready: true, count: 1, revision: 'r' });
  for (const result of [{ $fault: { code: 'account_deleting', message: 'gone' } }, null, { owner: crypto.randomUUID(), ready: true, count: 1, revision: 'r' }, { owner, ready: 1, count: 1, revision: 'r' }, { owner, ready: true, count: -1, revision: 'r' }])
    await assert.rejects(port(result).state(owner), JSON.stringify(result));
  const calls = []; const recorder = port((target, method, args) => { calls.push([target, method, args]); return { accepted: 2 }; });
  assert.deepEqual(await recorder.notify(owner, 'email-removed'), { accepted: 2 });
  assert.deepEqual(calls, [[owner, 'accountSecurityNotice', [owner, { event: 'email-removed' }]]]);
  await assert.rejects(recorder.notify(owner, 'other'), TypeError);
  assert.throws(() => accountChannelsPort(), TypeError);
});

function memoryBucket() { const map = new Map(); return { map, async get(key) { const v = map.get(key); return v ? { size: v.byteLength, arrayBuffer: async () => v.slice().buffer, text: async () => new TextDecoder().decode(v) } : null; }, async put(key, value) { map.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)); return { key }; }, async delete(keys) { for (const key of [keys].flat()) map.delete(key); } }; }

test('Node integration: removal with a push device keeps a channel, and the open lifecycle notice episode sees the channel change', async t => {
  const clock = fakeClock(Date.now() - DAY), idDb = new SqliteMetadata(':memory:'), db = new SqliteMetadata(':memory:'); t.after(() => { idDb.close(); db.close(); });
  const repository = new IdentityRepository({ metadata: idDb, config: {} }), mails = [], pushes = [];
  const push = { async send(subscription, payload) { pushes.push(payload); return { accepted: true }; } };
  const config = { APP_ORIGIN: 'https://lifecycle.example', POLAR_SERVER: 'sandbox', LIFECYCLE_ENABLED: 'true', LIFECYCLE_DRY_RUN: 'false', LIFECYCLE_PURGE_ENABLED: 'false', LIFECYCLE_FINANCE_REVIEW: 'local-only',
    LIFECYCLE_CLOCK: clock.now, LIFECYCLE_LOG: () => {}, LIFECYCLE_IDENTITY: lifecycleIdentityPort(repository, { clock: clock.now }), LIFECYCLE_ADMIN_HOLD: async () => ({ held: false, since: null, releasedAt: null }),
    LIFECYCLE_MAIL: { async sendAccountNotice(input) { mails.push(input); return { messageId: 'mail-' + mails.length }; } }, LIFECYCLE_PUSH: push };
  const controller = new AccountController({ metadata: db, gate: new SerialGate(), blobs: memoryBucket(), archives: memoryBucket(), config, sql: db.sql });
  // The account object's channel RPCs, reached through the identity-side port exactly as an adapter would.
  const invoke = async (owner, method, args) => method === 'accountChannels' ? accountChannelState(db, owner, { push }) : accountSecurityNotice(db, owner, { push, ...args[1] });
  const alerts = [], service = identityEngine({ repository, clock, flags: ON, accountChannels: accountChannelsPort(invoke) });
  service.resources.mailer.sendSecurityAlert = async value => { alerts.push(value); return { messageId: 'a' }; };
  const { id: owner, handle } = await withEmail(service);
  await controller.warm(owner); await controller.rememberSignupOrigin(owner, { createdAt: (await repository.get(owner)).createdAt });
  await controller.subscribe(owner, { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/device', keys: { p256dh, auth } } });
  await controller.invoke({ method: 'touch', args: [owner] });
  clock.advance(2 * DAY + MINUTE);
  const warned = await controller.lifecycleTick(owner); assert.equal(warned.action, 'notice-recorded', JSON.stringify(warned));
  assert.equal(mails.at(-1).email, OLD);
  // The setup session expired during the two days; the owner signs in again and steps up.
  const ctx = sessionContext(await signInPasskey(service.act, handle, KEY));
  await step(service, ctx);
  const result = await service.service.emailRemove({ confirmed: true }, ctx);
  assert.deepEqual({ noticeWaived: result.noticeWaived, notified: result.notified }, { noticeWaived: false, notified: { email: true, push: true } });
  assert.deepEqual(pushes.at(-1), { type: 'bindle-security-notice', owner, event: 'email-removed', path: `/console?account=${owner}&security=review` });
  assert.deepEqual(alerts.at(-1), { email: OLD, type: 'email-removed', owner });
  assert.equal(await idDb.get(`email/${OLD}`), undefined);
  clock.advance(3 * DAY);
  const next = await controller.lifecycleTick(owner);
  assert.deepEqual({ action: next.action, reason: next.reason }, { action: 'hold', reason: 'contact-changed' }, JSON.stringify(next));
  assert.equal(mails.length, 1, 'no further notice goes to the removed address');
});
