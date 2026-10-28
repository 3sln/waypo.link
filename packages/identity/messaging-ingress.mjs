// The messaging-ingress occupant, as key delegation reads it (contacts-and-links spike §8 CR-C0; provisional, unsigned).
// Moved out of packages/links so key delegation never depends on the links code that CR-C1 deletes.
//
// - MESSAGING_INGRESS_FRAGMENT: the field whose exclusive occupant key delegation certifies (identity/delegation.mjs), the
//   connections domain treats as a delegation field (apps/connections.mjs) and brokered records recognize
//   (federation/brokered.mjs). Extensions rev 3.2 (CR-X3-26) republished the former messaging-ingress slot as this
//   ordinary fragment (docs/artefacts/fragments/messaging-ingress-v1.json). The spike later replaces it with the rev 3.1
//   Messaging `mailbox` fragment constant.
// - validateDescribe: the occupant's `describe` result (messaging §2.3). CR-C0 checked whether the delegation path depends
//   on it, and it does: runtime/routes/integrations.mjs records the validated `ingress` on the field entry
//   (`connections.set-ingress`, the only writer of an entry's ingress), the occupant port
//   (runtime/account/connections.mjs delegationSlotOccupant) reads it back, and DelegationRegistry certifies it as the
//   certificate's `client.ingress`. So validateDescribe lives on the delegation side; packages/links/handoff.mjs reuses it.
// Placeholders under spec.bindle.example until publication authority is agreed (messaging-protocol/constants.mjs, which
// core may not import, pins the same values).
export const MESSAGING_INGRESS_FRAGMENT = 'https://spec.bindle.example/fragments/messaging-ingress/v1';
export const MESSAGING_PROFILE = 'https://spec.bindle.example/messaging/v1';

export const DESCRIPTOR_LIMITS = Object.freeze({ maxParticipants: 32, maxMessageBytes: 1048576, maxEnvelopeBytes: 65536, maxBatchContexts: 32, maxProfiles: 16, maxVerifies: 64, cacheMs: 3600000 });
const KINDS = ['conversation-init', 'one-off'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function https(value, { allowLoopback = false, endpoint = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let u; try { u = new URL(value); } catch { return null; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (allowLoopback && loopback && u.protocol === 'http:')) || (loopback && !allowLoopback) || u.username || u.password || u.hash || value.includes('#') || u.search || value.includes('?')) return null;
  if (!endpoint && (u.pathname !== '/' || value !== u.origin)) return null;
  return endpoint && u.href !== value ? null : u;
}
const positive = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
/** §2.3 `describe` body (no `expiresAt`), exact members. Returns a detached copy or null. `origin`, when the
 * occupancy port knows it, must be the ingress origin. */
export function validateDescribe(input, { origin, allowLoopback = false } = {}) {
  let v; try { v = structuredClone(input); } catch { return null; }
  const names = ['version', 'profiles', 'ingress', 'limits', 'kinds'], optional = ['multicast', 'verifies'];
  if (!plain(v) || names.some(name => !Object.hasOwn(v, name)) || Object.keys(v).some(name => !names.includes(name) && !optional.includes(name)) || v.version !== 1) return null;
  if (!Array.isArray(v.profiles) || !v.profiles.length || v.profiles.length > DESCRIPTOR_LIMITS.maxProfiles || new Set(v.profiles).size !== v.profiles.length || !v.profiles.every(p => typeof p === 'string' && p.length <= 256 && https(p, { endpoint: true })) || !v.profiles.includes(MESSAGING_PROFILE)) return null;
  const ingress = https(v.ingress, { allowLoopback, endpoint: true }); if (!ingress || (origin !== undefined && ingress.origin !== origin)) return null;
  if (Object.hasOwn(v, 'multicast') && https(v.multicast, { allowLoopback, endpoint: true })?.origin !== ingress.origin) return null;
  if (Object.hasOwn(v, 'verifies') && (!Array.isArray(v.verifies) || v.verifies.length > DESCRIPTOR_LIMITS.maxVerifies || new Set(v.verifies).size !== v.verifies.length || !v.verifies.every(o => https(o, { allowLoopback })))) return null;
  const l = v.limits, limitNames = ['maxParticipants', 'maxMessageBytes', 'maxEnvelopeBytes'];
  if (!plain(l) || limitNames.some(name => !positive(l[name], DESCRIPTOR_LIMITS[name])) || Object.keys(l).some(name => ![...limitNames, 'maxBatchContexts'].includes(name)) || (Object.hasOwn(l, 'maxBatchContexts') && !positive(l.maxBatchContexts, DESCRIPTOR_LIMITS.maxBatchContexts))) return null;
  if (!Array.isArray(v.kinds) || !v.kinds.length || !v.kinds.every((k, i) => KINDS.includes(k) && (i === 0 || v.kinds[i - 1] < k))) return null;
  return v;
}
