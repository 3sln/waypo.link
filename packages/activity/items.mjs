// Activity items: the stored v1 app messages (`app-message/<owner>/<id>`, ./app-messages.mjs) with their placement
// (collections), owner rules and tag labels. This is the activity half of the former packages/messaging/messages.mjs
// MessagingService; the peer half (contact-grant delivery, `receive`) was removed from core with legacy messaging on
// 2026-10-27 (DEVLOG "Messaging removed from core; Parlay rename; BB-CUT reset"). Collections remain only as the
// placement that app messages, MCP grants and retention units still name (remaining coupling, messaging-extraction §2.8.1).
import {publicMessageMetadata as metadata} from './item-metadata.mjs';
import {validTagIds,isSuspectedTag,validateTagActions,changeTags,applyRules,migrateTags,seedDefaultRules,stampRules,normalizeAutomatedResult,validUserTagId,validTagLabel,ownerRules} from '../core/tags.mjs';
import { fail, key, boundedString } from '../core/records.mjs';
import { itemRecord, itemPrefixes, usageKeyOf } from './app-messages.mjs';

const validateActions = actions => {
  validateTagActions(actions, ['collection', 'tags', 'addTags', 'removeTags', 'classification', 'quarantined', 'read']);
  if (actions.collection !== undefined && !boundedString(actions.collection)) fail('invalid_actions');
  if (actions.quarantined !== undefined && typeof actions.quarantined !== 'boolean') fail('invalid_actions');
  if (actions.read !== undefined && typeof actions.read !== 'boolean') fail('invalid_actions');
};
const validMatch = match => match && typeof match === 'object' && !Array.isArray(match) && Object.keys(match).every(field => ['grantId', 'mimeType', 'collection', 'tagsAll', 'source'].includes(field)) && Object.entries(match).every(([field, value]) => field === 'tagsAll' ? validTagIds(value) && value.length > 0 : field === 'source' ? ['classifier', 'heuristic'].includes(value) && Boolean(match.tagsAll?.some(isSuspectedTag)) : boundedString(value));

export class ItemService {
  constructor({ store, crypto = globalThis.crypto, clock = () => Date.now(), maxStoredBytes = 1073741824, maxStoredMessages = 10000, indexedList }) { Object.assign(this, { store, crypto, clock, maxStoredBytes, maxStoredMessages, indexedList }); }
  async createCollection(owner, name) {
    if (!boundedString(owner) || !boundedString(name, 100)) fail('invalid_collection');
    return this.store.transaction(async tx => {
      if ((await tx.list(key('collection', owner))).length >= 100) fail('collection_limit');
      const collection = { id: this.crypto.randomUUID(), owner, name, active: true };
      await tx.set(key('collection', owner, collection.id), collection); return collection;
    });
  }
  async collections(owner) { return this.store.transaction(async tx => (await tx.list(key('collection', owner))).map(row => row.value)); }
  async disableCollection(owner, id) {
    return this.store.transaction(async tx => {
      const path = key('collection', owner, id); const collection = await tx.get(path);
      if (!collection) fail('not_found'); collection.active = false; await tx.set(path, collection);
    });
  }
  async setRules(owner, rules) {
    if (!Array.isArray(rules) || rules.length > 100) fail('invalid_rules');
    return this.store.transaction(async tx => {
      const ids = new Set(), state = await tx.get(key('rule-defaults', owner));
      for (const rule of rules) {
        if (!rule || !boundedString(rule.id) || ids.has(rule.id) || typeof rule.enabled !== 'boolean' || !validMatch(rule.match)) fail('invalid_rules');
        validateActions(rule.actions);
        if (Object.hasOwn(rule.actions, 'read')) fail('invalid_rules');
        if (rule.actions.collection && !(await tx.get(key('collection', owner, rule.actions.collection)))?.active) fail('invalid_collection');
        ids.add(rule.id);
      }
      // A first write before any seeding keeps the owner's list and appends defaults after it.
      const stamped = stampRules(rules, state ? await ownerRules(tx, owner) : []);
      await tx.set(key('rules', owner), stamped); return state ? stamped : ownerRules(tx, owner);
    });
  }
  async rules(owner) { return this.store.transaction(tx => ownerRules(tx, owner)); }
  /** Removes one rule in a single transaction and returns the remaining list. The former read-then-replace
   * pair was atomic only behind the account gate; one transaction keeps it atomic without relying on that. */
  async deleteRule(owner, id) {
    if (typeof id !== 'string') fail('invalid_rules');
    return this.store.transaction(async tx => {
      const rules = await ownerRules(tx, owner), remaining = rules.filter(rule => rule.id !== id);
      if (remaining.length !== rules.length) await tx.set(key('rules', owner), remaining);
      return remaining;
    });
  }
  /** Restores a deleted or edited default rule to its current shipped definition (keeps the enabled choice). */
  async restoreDefaultRule(owner, id) {
    const fresh = seedDefaultRules([], null).rules.find(rule => rule.id === id); if (!fresh) fail('not_found');
    return this.store.transaction(async tx => {
      const rules = await ownerRules(tx, owner), at = rules.findIndex(rule => rule.id === id), prior = rules[at], next = { ...fresh, enabled: prior?.enabled ?? fresh.enabled, revision: (prior?.revision ?? 0) + 1 };
      if (at >= 0) rules[at] = next; else { if (rules.length >= 100) fail('invalid_rules'); rules.push(next); }
      await tx.set(key('rules', owner), rules); return next;
    });
  }
  /** Owner label registry: renaming a label never retags messages, rules, Views or intake configuration. */
  async tagLabels(owner) { return this.store.transaction(async tx => await tx.get(key('tag-labels', owner)) || { revision: 0, labels: {} }); }
  async setTagLabel(owner, { id, label, expectedRevision } = {}) {
    if (label !== null && !validTagLabel(label) || id !== undefined && !validUserTagId(id) || id === undefined && label === null || expectedRevision !== undefined && !Number.isSafeInteger(expectedRevision)) fail('invalid_tag_label');
    return this.store.transaction(async tx => {
      const registry = await tx.get(key('tag-labels', owner)) || { revision: 0, labels: {} };
      if (expectedRevision !== undefined && registry.revision !== expectedRevision) fail('tag_label_conflict');
      const tag = id ?? 't.' + this.crypto.randomUUID().replaceAll('-', '').slice(0, 20);
      if (label === null) delete registry.labels[tag]; else { if (!Object.hasOwn(registry.labels, tag) && Object.keys(registry.labels).length >= 500) fail('tag_label_limit'); registry.labels[tag] = label; }
      registry.revision++; await tx.set(key('tag-labels', owner), registry); return { id: tag, label, revision: registry.revision };
    });
  }
  async list(owner, { collection, unread, quarantined, limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('invalid_limit');
    // Legacy arrays take no cursor. Index and scan share one normalization: a missing readAt is unread and a missing
    // quarantined flag is not quarantined; a filter of the wrong type matches nothing (DEVLOG 2026-10-23 follow-ups).
    if (this.indexedList) return this.indexedList(owner, { collection, unread, quarantined, limit });
    return this.store.transaction(async tx => (await tx.list(itemPrefixes(owner)[0])).map(row => migrateTags(row.value)).filter(message => (collection === undefined || message.collection === collection) && (unread === undefined || (message.readAt == null) === unread) && (quarantined === undefined || Boolean(message.quarantined) === quarantined)).sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id)).slice(0, limit).map(metadata));
  }
  async read(owner, id) { return this.store.transaction(async tx => { const message = (await itemRecord(k => tx.get(k), owner, id))?.record; if (!message) fail('not_found'); return migrateTags(message); }); }
  async update(owner, id, actions, provenance = { source: 'owner' }) {
    validateActions(actions);
    return this.store.transaction(async tx => {
      const found = await itemRecord(k => tx.get(k), owner, id); if (!found) fail('not_found');
      const path = found.path, now = this.clock(), message = migrateTags(found.record);
      if (actions.collection && !(await tx.get(key('collection', owner, actions.collection)))?.active) fail('invalid_collection');
      const { read, tags, addTags, removeTags, classification, ...changes } = actions; Object.assign(message, changes);
      changeTags(message, { tags, addTags, removeTags, classification }, provenance, now, { owner: true });
      // Only explicit owner action releases quarantine; automation then never re-quarantines.
      if (actions.quarantined !== undefined) message.quarantineReleased = !actions.quarantined;
      if (read !== undefined) message.readAt = read ? now : null;
      await tx.set(path, message);
      if (actions.quarantined === false && message.readAt === null && !(await tx.get(key('notification-event', owner, id)))) await tx.set(key('notification-event', owner, id), { id, owner, messageId: id, createdAt: now });
      return metadata(message);
    });
  }
  /** Internal classifier/heuristic boundary (no owner, app or MCP route): applies registered suspected tags with
   * evidence, then runs only rules newly matched by them, atomically. Never invokes a model. */
  async applyAutomatedTags(owner, id, input) {
    const result = normalizeAutomatedResult(input);
    return this.store.transaction(async tx => {
      const found = await itemRecord(k => tx.get(k), owner, id); if (!found) fail('not_found');
      const path = found.path, now = this.clock(), message = migrateTags(found.record);
      const { source, labels, model, version } = result, newly = [], evidence = probability => ({ ...model ? { model } : {}, version, ...probability !== undefined ? { probability } : {} });
      message.classificationResult = { ...message.classificationResult, [source]: { ...result, at: now } };
      for (const { tag, probability } of labels) {
        const prior = message.automated?.[tag];
        if (prior?.[source]) continue;
        newly.push(tag); message.automated = { ...message.automated, [tag]: { ...prior, [source]: { ...evidence(probability), at: now } } };
        if (!prior && !message.tagSuppressed?.includes(tag) && !message.tags.includes(tag)) { message.tags = [...message.tags, tag]; message.tagProvenance = { ...message.tagProvenance, [tag]: { source, ...evidence(probability), at: now } }; message.tagHistory = [...message.tagHistory ?? [], { at: now, op: 'add', tag, source }].slice(-16); }
      }
      const wasQuarantined = message.quarantined;
      if (newly.length) await applyRules(message, await ownerRules(tx, owner), { phase: 'automated', newly, now, active: async collection => (await tx.get(key('collection', owner, collection)))?.active });
      await tx.set(path, message);
      // Dispatch also rechecks quarantine; a notification may already have been sent before classification.
      if (message.quarantined && !wasQuarantined) await tx.delete(key('notification-event', owner, id));
      return metadata(message);
    });
  }
  async delete(owner, id) {
    return this.store.transaction(async tx => {
      const found = await itemRecord(k => tx.get(k), owner, id); if (!found) fail('not_found'); const { path, record: message } = found;
      const usageKey = usageKeyOf(path, owner), usage = await tx.get(usageKey);
      if (usage) { usage.bytes -= message.size; usage.messages--; await tx.set(usageKey, usage); }
      await tx.delete(path); await tx.delete(key('notification-event', owner, id)); return { deleted: true };
    });
  }
}
