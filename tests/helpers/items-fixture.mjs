// Engine-level activity-items fixture (not a test file): ItemService over the in-memory store with a fake clock.
// `deliver()` admits one item the way v1 app intake stores it (runtime/app-notifications.mjs): placement in the active
// collection, initial tags from the admission's tags, owner rules against the original metadata, usage and the
// notification event in one transaction. It replaces the legacy contact-delivery fixture (messaging-fixture.mjs),
// which left the core with messaging on 2026-10-27; tag, rule and notification behaviour is unchanged.
import { MemoryMessagingStore, key } from '../../packages/core/records.mjs';
import { initialTags, applyRules, ownerRules } from '../../packages/core/tags.mjs';
import { ItemService } from '../../packages/activity/items.mjs';
import { appMessageKey, appMessageUsageKey } from '../../packages/activity/app-messages.mjs';
import { fakeClock } from './chaos.mjs';

export const OWNER = '22222222-2222-4222-8222-222222222222', COLLECTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const START = Date.UTC(2026, 9, 14, 12), enc = new TextEncoder();

export async function itemsFixture({ intake = { autoTags: ['contact:developer'] } } = {}) {
  const clock = fakeClock(START), raw = new MemoryMessagingStore();
  await raw.transaction(tx => tx.set(key('collection', OWNER, COLLECTION), { id: COLLECTION, owner: OWNER, name: 'Inbox', active: true }));
  const messages = new ItemService({ store: raw, clock: clock.now });
  const deliver = ({ text = 'Hello', tags = intake.autoTags ?? [] } = {}) => raw.transaction(async tx => {
    const id = crypto.randomUUID(), body = enc.encode(text), now = clock.now();
    const message = initialTags({ id, owner: OWNER, collection: COLLECTION, deliveryCollection: COLLECTION, mimeType: 'text/plain', size: body.byteLength, bytes: body, receivedAt: now, readAt: null, deliveryTags: [...tags], quarantined: false, grantId: null }, [...tags], { source: 'app' }, now);
    await applyRules(message, await ownerRules(tx, OWNER), { now, active: async collection => (await tx.get(key('collection', OWNER, collection)))?.active });
    const usage = await tx.get(appMessageUsageKey(OWNER)) ?? { bytes: 0, messages: 0 };
    await tx.set(appMessageUsageKey(OWNER), { bytes: usage.bytes + body.byteLength, messages: usage.messages + 1 });
    await tx.set(appMessageKey(OWNER, id), message);
    if (!message.quarantined) await tx.set(key('notification-event', OWNER, id), { id, owner: OWNER, messageId: id, createdAt: now });
    return { receipt: { payload: { messageId: id } } };
  });
  // Observable state: the owner's item list, usage and outbox events.
  const state = async () => {
    const list = await messages.list(OWNER, { limit: 1000 });
    return raw.transaction(async tx => ({ list, usage: await tx.get(appMessageUsageKey(OWNER)) ?? { bytes: 0, messages: 0 }, events: (await tx.list(key('notification-event', OWNER))).length }));
  };
  return { clock, raw, messages, deliver, state };
}
