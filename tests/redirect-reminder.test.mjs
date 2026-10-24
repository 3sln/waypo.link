// Expiry reminder (design §6.4, opt-in at transfer-out) and the redirect-extension interactions of redirect management:
// the transfer-out opt-in and commit, the reminder sweep (one verified email, 30 days before expiry, attempted-only
// evidence), email deletion on end, expiry and an extension after the reminder, leakage regressions, and the
// extension/end race (no automatic refund for an extension an early end settled).
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferFixture, DAY, HOUR, EMAIL, DEST } from './helpers/transfer-out.mjs';
import { managementFixture, memoryRepository } from './helpers/redirect-management.mjs';
import { fakePolar, extensionService, REDIRECT_ID } from './helpers/redirect-billing.mjs';
import { redirectRecordsPort, createRedirectReminders, redirectReminderTemplate, reminderState, afterExtension, endRedirect, movedAudit, REMINDER_LEAD, REDIRECT_TIMING } from '../packages/identity/redirect-records.mjs';
import { transferDueIndex, sweepTransferDue, transferIdentityPort } from '../packages/identity/transfer-out.mjs';
import { retainedMoved, movedWindow } from '../packages/identity/lifecycle-tombstone.mjs';
import { movedLookup } from '../packages/runtime/routes/moved.mjs';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { fakeClock, forEachSeed, createScheduler } from './helpers/chaos.mjs';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function movedFlow(fx, begin) { const draft = await fx.begin(begin); await fx.authorize({ draft: draft.draft }); await fx.post(); fx.clock.advance(25 * HOUR); return fx.post(); }
function movedRow(clock, extra = {}) {
  const now = clock.now();
  return { id: OWNER, status: 'moved', revision: 1, moved: { v: 1, to: { iss: 'https://new.example', identity: `https://new.example/identity/${OWNER}` }, redirectBase: 'https://new.example/from/a/', statement: 'statement', statementDigest: 'sha256-x', attestation: 'attestation', committedAt: now, redirectUntil: now + 90 * DAY, exportUntil: now + 30 * DAY, movedUntil: now + 90 * DAY, reminderEmail: { address: 'mover@mail.example', verifiedAt: now - DAY }, redirectId: REDIRECT_ID, ...extra } };
}

test('transfer-out: the reminder opt-in keeps exactly the verified email at commit and indexes the reminder 30 days before expiry', async t => {
  const fx = await transferFixture(t);
  const draft = await fx.begin({ redirect: true, reminder: true });
  assert.equal(draft.reminder, true);
  assert.equal((await movedFlow(fx, { redirect: true, reminder: true })).status, 'attested');
  const record = await fx.get(), moved = (await fx.identityRecord()).moved;
  assert.deepEqual(moved.reminderEmail, { address: EMAIL, verifiedAt: (await fx.identityRecord()).emailVerifiedAt });
  assert.equal(moved.reminder, undefined, 'the opt-in flag never reaches the tombstone');
  assert.deepEqual(moved.audit.map(entry => entry.event), ['reminder-email-kept']);
  const due = await fx.ports.due.due({ now: Infinity });
  assert.deepEqual(due.map(row => row.kind).sort(), ['moved-end', 'moved-probe', 'moved-reminder', 'tick']);
  assert.equal(due.find(row => row.kind === 'moved-reminder').at, record.redirectUntil - REMINDER_LEAD);
});

test('transfer-out: no verified email, no reminder (recorded); no opt-in, nothing kept; a reminder without a redirect is refused', async t => {
  const none = await transferFixture(t, { identity: { verifiedEmail: null, emailVerifiedAt: null } });
  await movedFlow(none, { redirect: true, reminder: true });
  const moved = (await none.identityRecord()).moved;
  assert.equal(moved.reminderEmail, undefined); assert.deepEqual(moved.audit.map(entry => entry.event), ['reminder-unavailable']);
  const plain = await transferFixture(t);
  await movedFlow(plain, { redirect: true });
  assert.equal((await plain.identityRecord()).moved.reminderEmail, undefined); assert.equal((await plain.identityRecord()).moved.audit, undefined);
  assert.ok(!(await plain.ports.due.due({ now: Infinity })).some(row => row.kind === 'moved-reminder'));
  const refused = await transferFixture(t);
  await assert.rejects(() => refused.begin({ redirect: false, reminder: true }), { code: 'invalid_request' });
  await assert.rejects(() => refused.begin({ redirect: true, reminder: 'yes' }), { code: 'invalid_request' });
});

test('the reminder goes out once at 30 days before expiry, to the kept address, with attempted-only evidence', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
  const records = redirectRecordsPort(repository, { clock: clock.now }), sent = [];
  const send = async input => { sent.push(input); return true; };
  assert.deepEqual(await records.remind(OWNER, { send }), { ok: true, done: false, nextAt: clock.now() + 60 * DAY });
  assert.equal(sent.length, 0);
  clock.advance(60 * DAY);
  const results = await Promise.all([records.remind(OWNER, { send }), records.remind(OWNER, { send }), records.remind(OWNER, { send })]);
  assert.equal(sent.length, 1, 'concurrent sweeps send once'); assert.equal(sent[0].email.address, 'mover@mail.example'); assert.equal(sent[0].to.iss, 'https://new.example');
  assert.ok(results.every(result => result.ok));
  const moved = (await repository.get(OWNER)).moved;
  assert.deepEqual({ ...moved.reminder, attemptedAt: 0 }, { for: moved.redirectUntil, attempts: 1, attemptedAt: 0, accepted: true, state: 'sent' });
  assert.deepEqual(moved.audit.map(entry => entry.event), ['reminder-attempted']);
  assert.equal(moved.reminderEmail.address, 'mover@mail.example', 'kept until the redirect ends');
  assert.deepEqual(await records.remind(OWNER, { send }), { ok: true, done: true });
});

test('an unaccepted reminder is retried daily up to three attempts, then given up', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
  const records = redirectRecordsPort(repository, { clock: clock.now }); let attempts = 0;
  const send = async () => { attempts++; throw new Error('mail down'); };
  clock.advance(60 * DAY);
  for (let i = 0; i < 5; i++) { await records.remind(OWNER, { send }); clock.advance(REDIRECT_TIMING.reminderRetry); }
  assert.equal(attempts, 3);
  const moved = (await repository.get(OWNER)).moved;
  assert.equal(moved.reminder.accepted, false); assert.equal(moved.reminder.attempts, 3);
  assert.deepEqual(reminderState(moved, clock.now()), { done: true });
});

test('the sweep reschedules, completes and waits for a reminders port; the mail port gets the host and purchase link only', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
  const db = new SqliteMetadata(':memory:'), index = transferDueIndex(db), mails = [];
  try {
    const mail = { sendRedirectReminder: async input => { mails.push(input); return { messageId: 'm1' }; } };
    const reminders = createRedirectReminders({ records: redirectRecordsPort(repository, { clock: clock.now }), mail, origin: 'https://a.example', capability: async () => 'c'.repeat(64) });
    await index.put(OWNER, clock.now(), 'moved-reminder');
    assert.deepEqual(await sweepTransferDue({ index, identity: {}, accounts: {}, now: clock.now() }), { done: 0, failed: 1 }, 'no reminders port: the row waits');
    await sweepTransferDue({ index, identity: {}, accounts: {}, reminders, now: clock.now() });
    const rows = await index.due({ now: Infinity }); assert.equal(rows.length, 1); assert.equal(rows[0].at, clock.now() + 60 * DAY);
    clock.advance(60 * DAY);
    assert.deepEqual(await sweepTransferDue({ index, identity: {}, accounts: {}, reminders, now: clock.now() }), { done: 1, failed: 0 });
    assert.equal((await index.due({ now: Infinity })).length, 0);
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0], { email: 'mover@mail.example', notice: { redirectUntil: clock.now() + 30 * DAY, host: 'new.example', link: 'https://a.example/moved/' + 'c'.repeat(64) } });
    const template = redirectReminderTemplate(mails[0].notice, { origin: 'https://a.example' });
    assert.match(template.text, /new\.example/); assert.doesNotMatch(template.text, new RegExp(OWNER)); assert.doesNotMatch(template.text, /identity\//);
    assert.throws(() => redirectReminderTemplate({ ...mails[0].notice, link: 'https://evil.example/moved/' + 'c'.repeat(64) }, { origin: 'https://a.example' }));
  } finally { db.close(); }
});

test('the email is deleted when the redirect ends early, at expiry, and on an extension after the reminder; each is recorded', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23));
  const ended = await endRedirect(movedRow(clock).moved, clock.now());
  assert.equal(ended.moved.reminderEmail, undefined); assert.equal(ended.moved.audit[0].reason, 'ended');
  // Expiry: the scheduler's endMoved deletes it with the record and records it in the address-free trail.
  const repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock, { movedUntil: clock.now() + 90 * DAY }));
  clock.advance(91 * DAY);
  await transferIdentityPort(repository, { clock: clock.now }).endMoved(OWNER);
  const stub = (await repository.get(OWNER)).moved;
  assert.equal(stub.ended, true); assert.equal(stub.reminderEmail, undefined);
  assert.deepEqual(stub.audit.map(entry => [entry.event, entry.reason]), [['reminder-email-deleted', 'expired'], ['moved-record-ended', undefined]]);
  // Extension after the reminder: deleted; before: kept and moved to the new expiry.
  const base = movedRow(clock).moved, now = clock.now(), extended = { ...structuredClone(base), redirectUntil: base.redirectUntil + 3650 * DAY };
  const after = afterExtension({ ...base, reminder: { for: base.redirectUntil, attempts: 1, attemptedAt: now, accepted: true } }, extended, now);
  assert.equal(after.moved.reminderEmail, undefined); assert.equal(after.reminderAt, null); assert.equal(after.moved.audit.at(-1).reason, 'extended-after-reminder');
  const before = afterExtension(base, extended, now);
  assert.equal(before.moved.reminderEmail.address, 'mover@mail.example'); assert.equal(before.reminderAt, extended.redirectUntil - REMINDER_LEAD);
});

test('leakage: the reminder email never appears in public projections, audit entries or the purged tombstone', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
  const env = { IDENTITY_REPOSITORY: repository, MOVED_CLOCK: clock.now, APP_ORIGIN: 'https://a.example' };
  assert.doesNotMatch(JSON.stringify(await movedLookup(env, { sub: OWNER })), /mail\.example/);
  const polar = fakePolar({ clock, owner: OWNER }), service = extensionService({ repository, clock, polar, owner: OWNER, due: { put: async () => {} } });
  assert.doesNotMatch(JSON.stringify(await service.status(REDIRECT_ID)), /mail\.example/);
  assert.deepEqual(movedAudit({}, { event: 'x', reason: 'mover@mail.example', at: 1 }), [{ event: 'x', at: 1 }], 'audit entries drop anything address-like');
  assert.deepEqual(movedAudit({}, { event: 'x', reason: 'https://new.example', at: 1 }), [{ event: 'x', at: 1 }]);
  // Purge after the redirect stopped (or at the export window when not live) keeps no email.
  clock.advance(91 * DAY);
  const stopped = retainedMoved(movedRow(clock, { redirectUntil: clock.now() - DAY, movedUntil: clock.now() + DAY }).moved, clock.now());
  assert.equal(typeof stopped.attestation, 'string'); assert.equal(stopped.reminderEmail, undefined); assert.equal(stopped.redirectBase, undefined);
});

test('extension billing: before the reminder it keeps the email and reschedules; an early end settles the order and a redelivery refunds nothing', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
  const polar = fakePolar({ clock, owner: OWNER }), due = [], service = extensionService({ repository, clock, polar, owner: OWNER, due: { put: async (owner, at, kind) => { due.push({ owner, at, kind }); } } });
  polar.add('order1');
  const extended = await service.applyWebhook(polar.event('order1'));
  const moved = (await repository.get(OWNER)).moved;
  assert.equal(moved.reminderEmail.address, 'mover@mail.example');
  assert.deepEqual(due.filter(row => row.kind === 'moved-reminder').map(row => row.at), [extended.redirectUntil - REMINDER_LEAD]);
  // The owner ends the redirect early: no refund; the recorded order is settled as a digest only.
  const records = redirectRecordsPort(repository, { clock: clock.now });
  assert.equal((await records.end(OWNER, { expect: 'sha256-x' })).changed, true);
  const after = (await repository.get(OWNER)).moved;
  assert.equal(after.extensionOrder, undefined); assert.match(after.settledOrder, /^[A-Za-z0-9_-]{43}$/); assert.doesNotMatch(JSON.stringify(after), /order1/);
  assert.equal(after.movedUntil, after.committedAt + REDIRECT_TIMING.proofMinimum);
  for (const type of ['order.paid', 'order.updated']) assert.equal((await service.applyWebhook(polar.event('order1', type))).ignored, true);
  assert.deepEqual(polar.refunds, [], 'ending early refunds nothing, and a redelivery is not mistaken for a purchase that bought nothing');
  // A new purchase processed after the end bought nothing and is refunded in full, once.
  polar.add('order2');
  await service.applyWebhook(polar.event('order2')); await service.applyWebhook(polar.event('order2'));
  assert.deepEqual(polar.refunds.map(row => [row.order, row.amount]), [['order2', 1000]]);
  assert.equal(movedWindow((await repository.get(OWNER)).moved, clock.now()).live, false, 'a purchase never revives an ended redirect');
});

test('race (seeded): extension purchase against an owner end never revives the redirect and refunds exactly the orders that bought nothing', async () => {
  await forEachSeed(16, async random => {
    const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(); repository.rows.set(OWNER, movedRow(clock));
    const scheduler = createScheduler(random), wrapped = scheduler.wrap(repository, 'identity'); wrapped.rows = repository.rows;
    const polar = fakePolar({ clock, owner: OWNER }), service = extensionService({ repository: wrapped, clock, polar, owner: OWNER, due: { put: async () => {} } });
    const records = redirectRecordsPort(wrapped, { clock: clock.now });
    const ids = ['o1', 'o2'].slice(0, 1 + random.int(2)); for (const id of ids) polar.add(id);
    const tasks = random.shuffle([...ids.map(id => () => service.applyWebhook(polar.event(id))), () => records.end(OWNER, { expect: 'sha256-x' })]);
    const results = await scheduler.run(tasks);
    for (const result of results) assert.equal(result.status, 'fulfilled', String(result.reason));
    // Settle: Polar redelivers each event once more.
    for (const id of ids) await service.applyWebhook(polar.event(id)).catch(() => {});
    const moved = (await repository.get(OWNER)).moved, refunded = polar.refunds.map(row => row.order);
    assert.equal(movedWindow(moved, clock.now()).live, false, 'the end always wins');
    assert.equal(moved.reminderEmail, undefined); assert.equal(moved.extensionOrder, undefined);
    assert.equal(new Set(refunded).size, refunded.length, 'no order refunded twice');
    const { orderDigest } = await import('../packages/identity/redirect-records.mjs');
    for (const id of ids) {
      const settled = moved.settledOrder === await orderDigest(id);
      assert.equal(refunded.includes(id), !settled, `${id}: refunded exactly when it bought nothing`);
    }
  });
});
