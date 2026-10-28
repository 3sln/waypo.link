// The messaging-ingress occupant, as key delegation reads it (contacts-and-links spike §8 CR-C0; provisional, unsigned).
// Moved out of packages/links so key delegation never depends on the links code that CR-C1 deletes.
//
// - MESSAGING_INGRESS_FRAGMENT: the fragment whose `mailbox` field (Bindle Messaging §2.1) holds the exclusive occupant
//   key delegation certifies (identity/delegation.mjs), the connections domain treats as a delegation field
//   (apps/connections.mjs) and brokered records recognize (federation/brokered.mjs). The pinned document is
//   docs/artefacts/fragments/messaging-ingress-v1.json. Its only consumer is the messaging-mailbox provider feature
//   (Bindle Messaging §2.5, app/domains/provider-features.mjs).
// - validateDescribe: the occupant's `describe` result, exactly `{version: 1, ingress}` (messaging §2.2, contacts spike
//   CR-M3). The delegation path depends on it: runtime/routes/integrations.mjs records the validated `ingress` on the
//   field entry (`connections.set-ingress`, the only writer of an entry's ingress), the occupant port
//   (runtime/account/connections.mjs delegationSlotOccupant) reads it back, and DelegationRegistry certifies it as the
//   certificate's `client.ingress`. (The contact-link descriptor handoff that also reused it was removed in contacts phase 4.)
// Placeholders under spec.bindle.example until publication authority is agreed (messaging-protocol/constants.mjs, which
// core may not import, pins the same values).
export const MESSAGING_INGRESS_FRAGMENT = 'https://spec.bindle.example/fragments/messaging-ingress/v1';
export const MESSAGING_PROFILE = 'https://spec.bindle.example/messaging/v1';

export const DESCRIPTOR_LIMITS = Object.freeze({ maxParticipants: 32, maxMessageBytes: 1048576, maxEnvelopeBytes: 65536, maxBatchContexts: 32, maxProfiles: 16, maxVerifies: 64, cacheMs: 3600000 });
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** The occupant's ingress URL (messaging §1, §2.2): absolute HTTPS, no userinfo, query or fragment, canonical; loopback
 * HTTP(S) only with `allowLoopback` (explicit development). Returns the parsed URL or null. */
function ingressURL(value, { allowLoopback = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let u; try { u = new URL(value); } catch { return null; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (allowLoopback && loopback && u.protocol === 'http:')) || (loopback && !allowLoopback) || u.username || u.password || u.hash || value.includes('#') || u.search || value.includes('?')) return null;
  return u.href === value ? u : null;
}
/** Messaging §2.2 `describe` result: exactly `{version: 1, ingress}`. `origin`, when the occupancy port knows it, must be
 * the ingress origin (the occupant's own origin). Returns a detached `{version: 1, ingress}` or null. */
export function validateDescribe(input, { origin, allowLoopback = false } = {}) {
  let v; try { v = structuredClone(input); } catch { return null; }
  if (!plain(v) || Object.keys(v).length !== 2 || !Object.hasOwn(v, 'version') || !Object.hasOwn(v, 'ingress') || v.version !== 1) return null;
  const ingress = ingressURL(v.ingress, { allowLoopback }); if (!ingress || (origin !== undefined && ingress.origin !== origin)) return null;
  return { version: 1, ingress: v.ingress };
}
