// Core links: the contact-link descriptor handoff (slice BB-C1b; superseded links §6.4; messaging-app.md §5 "Endpoints
// come from the occupant"; extensions rev 3.2: the occupant is the field's current value). Kept until contacts spike
// phase 4 removes contact links. Since 2026-10-28 the occupant's `describe` is exactly `{version: 1, ingress}` (Bindle
// Messaging §2.2) and is obtained through the messaging-mailbox provider feature (§2.5); this module adds the fixed
// descriptor values (profiles, limits) the withdrawn messaging-address descriptor carried, from constants.
//
// A sender who holds a contact link (from the landing page, an intent `web+bindle://send-message?contact-url=…`, or
// a QR code) GETs the link at the owner host with `Accept: application/vnd.bindle.messaging.ingress+json`. The provider
//   1. verifies the link itself (LinkService.verify: links §8 steps 1–2, exact stored claims, retired-key history);
//   2. reads the CURRENT occupant of the slot the link type is bound to (./types.mjs), through the occupancy port;
//   3. obtains that occupant's `describe` result through the provider's own consumer port (never from the sender or
//      from the slot), validates it (exact members), and serves `{version, profiles, ingress, limits}` with the link's
//      signed `kinds` and an `expiresAt` of at most one hour (and never past the link's own expiry).
// No occupant, an occupant whose describe fails or is invalid, or a failing port answers the single uniform
// `recipient_unavailable` (503, Retry-After 3600): nothing distinguishes an absent occupant from one mid-switch.
// Resolution delivers nothing, consumes no quota and creates no state. Describe results are cached per
// (owner, slot, occupant clientId, generation) for at most one hour, so replacing the occupant invalidates the cache.
import { fail } from '../core/records.mjs';
import { linkBinding } from './types.mjs';
// validateDescribe moved to the delegation side (contacts spike CR-C0): the validated ingress becomes the key-delegation
// certificate's client.ingress. Re-exported here until CR-C1 removes this module.
import { validateDescribe, DESCRIPTOR_LIMITS, MESSAGING_PROFILE } from '../identity/messaging-ingress.mjs';
export { validateDescribe, DESCRIPTOR_LIMITS };
/** The kinds a contact link may carry (links/types.mjs); the descriptor serves the link's own signed subset. */
export const DESCRIPTOR_KINDS = Object.freeze(['conversation-init', 'one-off']);
/** The fixed descriptor around a validated ingress: the messaging profile and the §11 maxima (contacts spike CR-M3
 * removed them from `describe`; peers learn an occupant's own parameters from signed bindings, messaging §2.2). */
export const descriptorFor = ({ ingress }) => ({ version: 1, profiles: [MESSAGING_PROFILE], ingress, limits: { maxParticipants: DESCRIPTOR_LIMITS.maxParticipants, maxMessageBytes: DESCRIPTOR_LIMITS.maxMessageBytes, maxEnvelopeBytes: DESCRIPTOR_LIMITS.maxEnvelopeBytes } });

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const unavailable = () => fail('recipient_unavailable');

export class LinkHandoff {
  /** `service`: LinkService (verify). `occupant({owner, slot})` -> {clientId, generation, origin?} | null: the
   * occupancy port (LINK_SLOT_OCCUPANT / EXT-X4). `describe({owner, slot, occupant})` -> describe body: the
   * provider's consumer call to the occupant's mailbox resource (brokered, EXT-X7); without it nothing resolves. */
  constructor({ service, occupant, describe, clock = () => Date.now(), allowLoopback = false, maxCache = 1024 } = {}) {
    if (typeof service?.verify !== 'function' || !Number.isSafeInteger(maxCache) || maxCache < 1) throw new TypeError('Invalid link handoff.');
    Object.assign(this, { service, occupant, describe, clock, allowLoopback: allowLoopback === true, maxCache, cache: new Map() });
  }
  /** Returns the ingress descriptor for a verified link, or throws link_invalid / link_malformed / recipient_unavailable. */
  async descriptor(url) {
    const verified = await this.service.verify(url), record = verified.record, binding = linkBinding(record.type), now = this.clock();
    if (!binding) fail('link_invalid');
    if (typeof this.occupant !== 'function' || typeof this.describe !== 'function') unavailable();
    let seat; try { seat = await this.occupant({ owner: record.owner, fragment: binding.fragment }); } catch { unavailable(); }
    if (!plain(seat) || typeof seat.clientId !== 'string' || !seat.clientId) unavailable();
    const cacheKey = JSON.stringify([record.owner, binding.fragment, seat.clientId, seat.generation ?? null, seat.origin ?? null]);
    let body = this.cache.get(cacheKey);
    if (!body || body.until <= now) {
      this.cache.delete(cacheKey);
      let described; try { described = await this.describe({ owner: record.owner, fragment: binding.fragment, occupant: { clientId: seat.clientId, generation: seat.generation ?? null, ...(typeof seat.origin === 'string' ? { origin: seat.origin } : {}) } }); } catch { unavailable(); }
      const valid = validateDescribe(described, { origin: typeof seat.origin === 'string' ? seat.origin : undefined, allowLoopback: this.allowLoopback });
      if (!valid) unavailable();
      body = { value: valid, until: now + DESCRIPTOR_LIMITS.cacheMs };
      // Bounded: the oldest entry goes first; a cache miss only costs one describe call.
      while (this.cache.size >= this.maxCache) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(cacheKey, body);
    }
    return { ...descriptorFor(body.value), kinds: verified.meta.claims.kinds.filter(kind => DESCRIPTOR_KINDS.includes(kind)), expiresAt: Math.min(body.until, now + DESCRIPTOR_LIMITS.cacheMs, verified.meta.claims.exp * 1000) };
  }
}
