// Activity items (packages/activity/items.mjs) and the activity notification engine over the in-memory store. The
// legacy peer half of this suite (contact tokens, grants, `receive`, per-grant quotas and key retirement) left the
// core with messaging on 2026-10-27 (DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"); items are
// admitted here the way v1 app intake stores them (runtime/app-notifications.mjs: placement, owner rules, event).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemService } from '../packages/activity/items.mjs';
import { NotificationService, defaultNotificationPreferences } from '../packages/activity/notifications.mjs';
import { renderMessage, inspectWebArchive, WEB_ARCHIVE_MIME } from '../packages/content/render.mjs';
import { MemoryMessagingStore, base64url, textEncoder, key } from '../packages/core/records.mjs';
import { initialTags, applyRules, ownerRules } from '../packages/core/tags.mjs';
import { appMessageKey, appMessageUsageKey } from '../packages/activity/app-messages.mjs';

const bytes = value => textEncoder.encode(value);
const rejects = (operation, code) => assert.rejects(operation, error => error.code === code);
async function fixture() {
  let now = 1800000000000;
  const clock = () => now;
  const store = new MemoryMessagingStore();
  const messages = new ItemService({ store, clock });
  const notifications = new NotificationService({ store, clock });
  const owner = 'account/alice';
  const inbox = await messages.createCollection(owner, 'Inbox');
  const other = await messages.createCollection(owner, 'Saved');
  // One stored item, admitted like a v1 app message: initial tags, owner rules against the original metadata, usage and
  // the notification event in one transaction (no event for a quarantined item).
  const receive = (value = 'Hello', { mimeType = 'text/plain', tags = [] } = {}) => store.transaction(async tx => {
    const id = crypto.randomUUID(), body = bytes(value), at = clock();
    const message = initialTags({ id, owner, collection: inbox.id, deliveryCollection: inbox.id, mimeType, size: body.byteLength, bytes: body, receivedAt: at, readAt: null, deliveryTags: tags, quarantined: false, grantId: null }, tags, { source: 'app' }, at);
    await applyRules(message, await ownerRules(tx, owner), { now: at, active: async collection => (await tx.get(key('collection', owner, collection)))?.active });
    const usage = await tx.get(appMessageUsageKey(owner)) || { bytes: 0, messages: 0 };
    await tx.set(appMessageUsageKey(owner), { bytes: usage.bytes + body.byteLength, messages: usage.messages + 1 });
    await tx.set(appMessageKey(owner, id), message);
    if (!message.quarantined) await tx.set(key('notification-event', owner, id), { id, owner, messageId: id, createdAt: at });
    return { id, accepted: true };
  });
  return { store, messages, notifications, owner, inbox, other, receive, clock, advance: duration => { now += duration; } };
}

test('rules match original metadata; quarantine remains sticky and owner can release', async () => {
  const f = await fixture();
  await f.messages.setRules(f.owner, [
    { id: 'move', enabled: true, match: { collection: f.inbox.id }, actions: { collection: f.other.id, tags: ['review'], quarantined: true } },
    { id: 'no-cascade', enabled: true, match: { collection: f.other.id }, actions: { classification: 'spam' } },
    { id: 'no-release', enabled: true, match: {}, actions: { quarantined: false } },
  ]);
  const result = await f.receive(); let message = await f.messages.read(f.owner, result.id);
  assert.equal(message.collection, f.other.id); assert.equal(message.classification, 'unclassified'); assert.equal(message.quarantined, true);
  assert.deepEqual(await f.store.transaction(tx => tx.list(key('notification-event', f.owner))), []);
  await f.messages.update(f.owner, result.id, { quarantined: false, classification: 'personal', read: true, tags: ['friend'] });
  message = await f.messages.read(f.owner, result.id); assert.equal(message.readAt, f.clock());
  await f.messages.update(f.owner, result.id, { read: false, quarantined: false });
  assert.equal((await f.store.transaction(tx => tx.list(key('notification-event', f.owner)))).length, 1);
});

test('HTML rendering reconstructs only inert tags and archives reject traversal/active formats', () => {
  const rendered = renderMessage({ mimeType: 'text/html', bytes: bytes('<p onclick="alert(1)">Hi<img src="https://evil.example"><script>alert(1)</script><a href="https://evil.example">link</a><iframe srcdoc="bad"></iframe></p>') });
  assert.equal(rendered.sandbox, ''); assert.equal(rendered.referrerPolicy, 'no-referrer');
  assert.ok(!rendered.html.includes('onclick')); assert.ok(!rendered.html.includes('<script')); assert.ok(!rendered.html.includes('<iframe')); assert.ok(!rendered.html.includes('https://evil.example')); assert.ok(rendered.html.includes('<p>Hi'));
  const archive = path => bytes(JSON.stringify({ version: 1, entrypoint: path, entries: [{ path, mimeType: 'text/html', data: base64url(bytes('<b>Archive</b>')) }] }));
  assert.equal(inspectWebArchive(archive('index.html')).entries.length, 1);
  assert.ok(renderMessage({ mimeType: WEB_ARCHIVE_MIME, bytes: archive('index.html') }).html.includes('<b>Archive</b>'));
  for (const path of ['../x', '/x', 'a\\b', 'a/%2e%2e/x', 'https://evil.example/x', 'a//b']) assert.throws(() => inspectWebArchive(archive(path)));
  assert.equal(renderMessage({ mimeType: 'application/vnd.3sln.webrtc+json', bytes: bytes('{}') }).kind, 'download');
});

test('transaction failures roll back writes', async () => {
  const store = new MemoryMessagingStore();
  await assert.rejects(() => store.transaction(async tx => { await tx.set('partial', true); throw new Error('stop'); }));
  assert.equal(await store.transaction(tx => tx.get('partial')), undefined);
});

async function enableEmail(f, overrides = {}) {
  const preferences = defaultNotificationPreferences(); Object.assign(preferences.email, { enabled: true, delayMinutes: 5, repeatHours: 1, maxReminders: 2 }, overrides);
  await f.notifications.setPreferences(f.owner, preferences, { verifiedEmail: true }); return preferences;
}

test('email reminders require opt-in, verification, delay, unread state and bounded repeats', async () => {
  const f = await fixture(); const received = await f.receive(); f.advance(600000);
  assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  const preferences = defaultNotificationPreferences(); preferences.email.enabled = true;
  await rejects(() => f.notifications.setPreferences(f.owner, preferences), 'verified_email_required');
  await enableEmail(f);
  let jobs = await f.notifications.claimDue(f.owner); assert.equal(jobs.length, 1); assert.equal(jobs[0].payload.body, 'You have an unread message.');
  assert.ok(!JSON.stringify(jobs[0]).includes('Hello')); assert.equal(await f.notifications.authorizeDelivery(f.owner, jobs[0].id, jobs[0].lease), true);
  await f.notifications.finish(f.owner, jobs[0].id, jobs[0].lease, { delivered: true });
  assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  f.advance(3600000); jobs = await f.notifications.claimDue(f.owner); assert.equal(jobs.length, 1);
  await f.messages.update(f.owner, received.id, { read: true });
  assert.equal(await f.notifications.authorizeDelivery(f.owner, jobs[0].id, jobs[0].lease), false);
});

test('notification leases deduplicate claims and reject stale completions', async () => {
  const f = await fixture(); await enableEmail(f); await f.receive(); f.advance(300000);
  const batches = await Promise.all(Array.from({ length: 8 }, () => f.notifications.claimDue(f.owner)));
  assert.equal(batches.flat().length, 1); const original = batches.flat()[0];
  f.advance(61000); const [retried] = await f.notifications.claimDue(f.owner); assert.notEqual(retried.lease, original.lease);
  await rejects(() => f.notifications.finish(f.owner, original.id, original.lease, { delivered: true }), 'stale_lease');
  await f.notifications.finish(f.owner, retried.id, retried.lease, { delivered: true });
});

test('unsubscribe suppresses leased delivery without disclosing recipient; repeat is idempotent', async () => {
  const f = await fixture(); await enableEmail(f); await f.receive(); f.advance(300000);
  const [job] = await f.notifications.claimDue(f.owner); const token = await f.notifications.issueUnsubscribe(f.owner);
  assert.deepEqual(await f.notifications.unsubscribe(token), { unsubscribed: true });
  assert.deepEqual(await f.notifications.unsubscribe(token), { unsubscribed: true });
  assert.equal(await f.notifications.authorizeDelivery(f.owner, job.id, job.lease), false);
  assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  await rejects(() => f.notifications.unsubscribe('x'.repeat(43)), 'invalid_unsubscribe');
});

test('quiet hours, collection/tag filtering, quarantine and deletion suppress notifications', async () => {
  const f = await fixture(); const preferences = await enableEmail(f); const received = await f.receive(); f.advance(300000);
  preferences.quiet = { enabled: true, startHour: 0, endHour: 0, utcOffsetMinutes: 0 };
  await f.notifications.setPreferences(f.owner, preferences, { verifiedEmail: true }); assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  preferences.quiet.enabled = false; preferences.collections = [f.other.id];
  await f.notifications.setPreferences(f.owner, preferences, { verifiedEmail: true }); assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  preferences.collections = []; preferences.excludeTags = ['mute'];
  await f.notifications.setPreferences(f.owner, preferences, { verifiedEmail: true });
  await f.messages.update(f.owner, received.id, { tags: ['mute'] }); assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  await f.messages.update(f.owner, received.id, { tags: [], quarantined: true }); assert.deepEqual(await f.notifications.claimDue(f.owner), []);
  await f.messages.update(f.owner, received.id, { quarantined: false }); const [job] = await f.notifications.claimDue(f.owner); assert.ok(job);
  await f.messages.delete(f.owner, received.id); assert.equal(await f.notifications.authorizeDelivery(f.owner, job.id, job.lease), false);
});

test('push device registration and revocation protect endpoints and suppress delivery', async () => {
  const f = await fixture();
  const subscription = { endpoint: 'https://fcm.googleapis.com/send/device-secret', keys: { p256dh: base64url(new Uint8Array(65).fill(4)), auth: base64url(new Uint8Array(16).fill(1)) } };
  await rejects(() => f.notifications.subscribe(f.owner, { ...subscription, endpoint: 'http://127.0.0.1/private' }), 'invalid_subscription');
  const device = await f.notifications.subscribe(f.owner, subscription);
  assert.equal((await f.notifications.subscriptions(f.owner))[0].endpoint, undefined);
  const preferences = defaultNotificationPreferences(); preferences.push.enabled = true; await f.notifications.setPreferences(f.owner, preferences);
  await f.receive(); const [job] = await f.notifications.claimDue(f.owner); assert.equal(job.channel, 'push');
  await f.notifications.unsubscribeDevice(f.owner, device.id); assert.equal(await f.notifications.authorizeDelivery(f.owner, job.id, job.lease), false);
});

