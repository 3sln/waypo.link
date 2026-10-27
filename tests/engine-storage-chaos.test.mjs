// Engine-level storage chaos: the portable account (AccountController over an
// in-memory SQLite metadata store and an in-memory blob store) receives
// messages while blob writes, blob deletes, metadata writes and commit
// acknowledgements fail. The reservation protocol must keep blobs, metadata
// and accounting consistent under every fault plan.
// Seeded: rerun a failure with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountController } from '../packages/runtime/accounts.mjs';
import { MESSAGE_RECEIPT_DEFAULTS } from '../packages/runtime/message-receipt-budget.mjs';
import { SqliteMetadata, SerialGate } from '../apps/node/resources.mjs';
import { appMessageKey, appMessageUsageKey } from '../packages/activity/app-messages.mjs';
import { forEachSeed, injectFaults } from './helpers/chaos.mjs';

const BASE = Number(process.env.CHAOS_SEED ?? 1);
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ORIGIN = 'https://space.example';
const generous = () => { const policy = structuredClone(MESSAGE_RECEIPT_DEFAULTS); for (const p of Object.values(policy)) for (const scope of ['owner', 'contact']) for (const name of ['minute', 'hour', 'day']) p[scope][name] = { messages: 1000, bytes: 1 << 26 }; return policy; };
class MemoryBucket {
  objects = new Map();
  async put(key, value) { this.objects.set(key, Uint8Array.from(value)); }
  async get(key) { const bytes = this.objects.get(key); return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } : null; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}
const fault = message => Object.assign(new Error(message), { code: 'injected_fault' });
// Metadata port with switchable faults: a failing `app-message/` row write inside a
// transaction (rolls it back) and a lost acknowledgement after a commit.
function faultyMetadata(db, plan) {
  return new Proxy(db, { get(target, prop) {
    if (prop === 'transaction') return async operation => {
      let wroteMessage = false;
      const result = await target.transaction(tx => operation(new Proxy(tx, { get(t, p) {
        if (p !== 'put') return t[p];
        return async (k, v) => { if (typeof k === 'string' && k.startsWith('app-message/')) { wroteMessage = true; if (plan.metadataWrite()) throw fault('metadata write failed'); } return t.put(k, v); };
      } })));
      if (wroteMessage && plan.ackLost()) throw fault('commit acknowledgement lost');
      return result;
    };
    const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function fixture(t, random) {
  const db = new SqliteMetadata(':memory:'); t.after(() => db.close());
  const bucket = new MemoryBucket(), plan = { on: false, fired: { metadataWrite: 0, ackLost: 0 }, metadataWrite: () => plan.on && random.chance(0.15) && ++plan.fired.metadataWrite > 0, ackLost: () => plan.on && random.chance(0.15) && ++plan.fired.ackLost > 0 };
  const when = () => plan.on && random.chance(0.2);
  const blobs = injectFaults(bucket, [
    { method: 'put', when, mode: random.pick(['throw', 'after', 'timeout']) },
    { method: 'delete', when, mode: 'throw' },
  ]);
  const controller = new AccountController({ metadata: faultyMetadata(db, plan), gate: new SerialGate(), blobs, archives: new MemoryBucket(), config: { APP_ORIGIN: ORIGIN, KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), WORK_LIMITS_ENABLED: 'false', STORAGE_WRITE_ENABLED: 'false', MESSAGE_RECEIPT_LIMITS: generous() } });
  await controller.warm(OWNER);
  const collection = (await controller.collections(OWNER))[0];
  // Item admission with the commit protocol of v1 app intake (runtime/app-notifications.mjs): an idempotency receipt,
  // a durable quota reservation, the blob upload outside SQL, then metadata, usage, index and receipt in one store
  // transaction, and the reservation released either way. Legacy peer `receive` left the core on 2026-10-27; this
  // drives the same quota, blob and store-adapter paths under the fault plans.
  const receive = async (keyName, text) => {
    const receiptKey = 'test-admission-receipt/' + keyName, prior = await controller.metadata.get(receiptKey);if (prior) return { id: prior.id, accepted: true };
    const bytes = new TextEncoder().encode(text), id = crypto.randomUUID();
    const reservation = await controller.quota.reserve(OWNER, { id, bytes: bytes.length, blobRef: `messages/${OWNER}/${id}`, kind: 'message' });controller.messageReservation = reservation;
    try {
      await controller.blobs.put(reservation.blobRef, bytes);
      return await controller.store.transaction(async tx => {
        const done = await tx.get(receiptKey);if (done) return { id: done.id, accepted: true };
        const usage = await tx.get(appMessageUsageKey(OWNER)) || { bytes: 0, messages: 0 };await tx.set(appMessageUsageKey(OWNER), { bytes: usage.bytes + bytes.length, messages: usage.messages + 1 });
        await tx.set(appMessageKey(OWNER, id), { id, owner: OWNER, collection: collection.id, deliveryCollection: collection.id, mimeType: 'text/plain', size: bytes.length, bytes, receivedAt: Date.now(), readAt: null, tags: [], grantId: null });
        await tx.set(receiptKey, { id });return { id, accepted: true };
      });
    } finally { controller.messageReservation = null; await controller.quota.release(id); }
  };
  return { db, bucket, blobs, plan, controller, receive };
}
// Consistency that must hold after any fault plan: every listed message has
// exactly its bytes, accounting matches, and no blob escapes both a message
// and a durable reservation.
async function consistent(f, sent) {
  const list = await f.controller.items.list(OWNER, { limit: 1000 }), usage = await f.controller.quota.usage(OWNER);
  for (const m of list) {
    const { bytes } = await f.controller.content(OWNER, m.id);
    assert.ok(sent.has(new TextDecoder().decode(bytes)), 'stored bytes are bytes a sender sent');
    assert.equal(bytes.byteLength, m.size);
  }
  assert.equal(usage.messageCount, list.length); assert.equal(usage.messagesBytes, list.reduce((s, m) => s + m.size, 0));
  // Deleted messages hand their blob to a durable garbage record that cleanup retries.
  const blobs = [...f.bucket.objects.keys()].filter(k => k.startsWith(`messages/${OWNER}/`)), garbage = (await f.db.list({ prefix: 'blob-garbage/' })).size;
  assert.ok(blobs.length <= list.length + usage.pendingUploads + garbage, `orphaned blobs: ${blobs.length} blobs, ${list.length} messages, ${usage.pendingUploads} reservations, ${garbage} garbage records`);
  return { list, usage, blobs };
}

test('blob/metadata fault plans: a received message is all-or-nothing and retries converge to exactly one message per key', async t => {
  t.diagnostic(`CHAOS_SEED base ${BASE}`);
  const fired = { metadataWrite: 0, ackLost: 0, blob: 0 };
  await forEachSeed(6, async random => {
    const f = await fixture(t, random), keys = Array.from({ length: 10 }, (_, i) => `key-${i}`), text = k => `body of ${k}`, sent = new Set(keys.map(text));
    f.plan.on = true;
    for (let round = 0; round < 3; round++) for (const k of random.shuffle(keys)) {
      try { await f.receive(k, text(k)); } catch (error) { assert.ok(['injected_fault', 'timeout'].includes(error.code), `unexpected ${error.code}: ${error.message}`); }
      await consistent(f, sent);
    }
    // Faults cleared: every key is retried until accepted, and each key maps to one message.
    f.plan.on = false;
    const ids = new Map(); for (const k of keys) ids.set(k, (await f.receive(k, text(k))).id);
    for (const k of keys) assert.equal((await f.receive(k, text(k))).id, ids.get(k), 'replay returns the original message');
    const { list } = await consistent(f, sent);
    assert.equal(list.length, keys.length); assert.equal(new Set(ids.values()).size, keys.length);
    fired.metadataWrite += f.plan.fired.metadataWrite; fired.ackLost += f.plan.fired.ackLost; fired.blob += f.blobs.calls.filter(c => c.fault).length;
  }, { base: BASE });
  assert.ok(fired.metadataWrite && fired.ackLost && fired.blob, `every fault kind was exercised ${JSON.stringify(fired)}`);
});

test('a committed message whose blob later disappears reports temporarily unavailable, never other bytes', async t => {
  const f = await fixture(t, { chance: () => false, pick: list => list[0] });
  const { id } = await f.receive('k', 'only these bytes');
  f.bucket.objects.clear();
  await assert.rejects(f.controller.content(OWNER, id), { code: 'temporarily_unavailable' });
  // Deleting the record still settles accounting even though the blob is already gone.
  await f.controller.deleteMessage(OWNER, id);
  const usage = await f.controller.quota.usage(OWNER); assert.equal(usage.messageCount, 0); assert.equal(usage.messagesBytes, 0);
});

test('storage quota is inclusive at the plan limit, caps pending uploads exactly and expires reservations at their TTL', async t => {
  const { StorageQuota } = await import('../packages/runtime/storage-quota.mjs'), { BILLING_PLANS } = await import('../packages/billing/index.mjs');
  const db = new SqliteMetadata(':memory:'); t.after(() => db.close());
  let now = Date.UTC(2026, 9, 14, 12); const bucket = new MemoryBucket(), quota = new StorageQuota({ metadata: db, blobs: bucket, clock: () => now, config: {} });
  const limit = BILLING_PLANS.free.storageBytes, id = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ref = i => `messages/${OWNER}/${id(i)}`;
  await quota.reserve(OWNER, { id: id(0), bytes: limit - 1, blobRef: ref(0), kind: 'message' });
  await assert.rejects(quota.reserve(OWNER, { id: id(1), bytes: 2, blobRef: ref(1), kind: 'message' }), { code: 'account_quota_exceeded' });
  await quota.reserve(OWNER, { id: id(1), bytes: 1, blobRef: ref(1), kind: 'message' });
  assert.equal((await quota.usage(OWNER)).remainingBytes, 0);
  // Zero-growth reservations still count against the pending-upload cap of 128.
  for (let i = 2; i < 128; i++) await quota.reserve(OWNER, { id: id(i), bytes: 0, blobRef: ref(i), kind: 'message' });
  await assert.rejects(quota.reserve(OWNER, { id: id(128), bytes: 0, blobRef: ref(128), kind: 'message' }), { code: 'account_quota_exceeded' });
  // One millisecond before the 20-minute TTL a commit succeeds; at the TTL it is refused and cleanup reclaims it.
  now += 20 * 60000 - 1; await db.transaction(tx => quota.commit(tx, id(0)));
  now += 1; await assert.rejects(db.transaction(tx => quota.commit(tx, id(1))), { code: 'conflict' });
  await bucket.put(ref(1), [1]);
  const cleaned = await quota.cleanup({ limit: 128 });
  assert.equal(cleaned.pending, 0); assert.equal(bucket.objects.has(ref(1)), false);
  // A clock that steps backwards cannot resurrect or extend anything.
  now -= 60 * 60000; assert.equal((await quota.usage(OWNER)).pendingUploads, 0);
});
