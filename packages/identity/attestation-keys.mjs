// PORT-4, P16: this provider's attestation key set as one continuity chain (docs/spec/identity-portability.md §5.1;
// design §2.7). It replaces the single-JWK `IDENTITY_ATTESTATION_KEY` stopgap of PORT-2, which is still accepted and
// read as a one-key root set.
//
// Configuration (`IDENTITY_ATTESTATION_KEYS`, a secret; JSON text or object):
//   {"v":1,"current":"<kid>","keys":[{"kid","jwk":{kty,crv,x,y,d?},"continuity"?:{"kid","sig"},"created"?:<unix s>}, …],
//    "removed"?:["<kid>", …]}
//   - `keys` are listed in introduction order, at most 64. The first key without `continuity` is the provider's root.
//     Every later key carries `continuity`: a 64-byte low-s ES256 signature by an EARLIER listed key over
//     `bindle-attestation-key-continuity-v1.` + the new key's RFC 7638 thumbprint (PORT-1 codec).
//   - Only `current` needs its private scalar `d`; any other `d` is dropped on parse and never used, so a retired key
//     cannot sign. Retired keys stay listed for as long as the provider operates (spec §5.1).
//   - `removed` names compromised kids taken out of the published set. A listed key whose continuity signer was
//     removed stays published; verifiers that pinned it keep trusting it, new verifiers do not (spec §5.1).
//   - A second key without continuity is a new root: verifiers treat it as an attestation reset. It is accepted
//     (a provider that lost every private key has no other way forward) and reported by `verifyAttestationKeySet`.
// A set that fails verification never signs: the attestor rejects, and PORT-2 commits hold.
//
// Verifier roots (P16): `SHIPPED_ATTESTATION_ROOTS` are preconfigured root thumbprints per issuer, never pinned on first
// use. 3sln.me's root is not minted (production release is disabled), so its list is empty: every 3sln.me attestation
// key is then untrusted (an attestation reset) rather than trusted on first use. The SDK owner ships the real root
// once it exists. A provider's own issuer always uses its own configured roots (`attestationRoots`).
import { attestationKeyThumbprint, signAttestationKeyContinuity, verifyAttestationKeyContinuity, signMoveAttestation, httpsOrigin } from './succession.mjs';
import { exactMembers, plainObject } from '../links/envelope.mjs';
import { fromBase64url } from '../core/records.mjs';

export const ATTESTATION_KEYS_PATH = '/bindle/portability/attestation-keys';
export const MAX_ATTESTATION_KEYS = 64;
/** Issuer → root thumbprints that verifiers preconfigure (spec §5.1; design §2.7, "The 3sln.me root ships in the SDK"). */
export const SHIPPED_ATTESTATION_ROOTS = Object.freeze({ 'https://3sln.me': Object.freeze([]) });

const P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const coordinate = value => { try { return typeof value === 'string' && fromBase64url(value).length === 32; } catch { return false; } };
const kidOk = kid => typeof kid === 'string' && kid.length > 0 && kid.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(kid);
const publicOf = jwk => ({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });

/** Structural parse of the configuration (or the legacy single `{kid, jwk}`). Returns a frozen set or null. Pure and
 * synchronous: signatures are checked by `verifyAttestationKeySet`. */
export function parseAttestationKeySet(config) {
  let value = config;
  if (typeof value === 'string') { if (value.length > 65536) return null; try { value = JSON.parse(value); } catch { return null; } }
  if (!plainObject(value)) return null;
  if (exactMembers(value, ['kid', 'jwk'])) value = { v: 1, current: value.kid, keys: [{ kid: value.kid, jwk: value.jwk }] };
  if (!exactMembers(value, ['v', 'current', 'keys'], ['removed']) || value.v !== 1 || !kidOk(value.current) || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > MAX_ATTESTATION_KEYS) return null;
  const removed = value.removed === undefined ? [] : value.removed;
  if (!Array.isArray(removed) || removed.length > MAX_ATTESTATION_KEYS || !removed.every(kidOk) || new Set(removed).size !== removed.length) return null;
  const kids = new Set(), points = new Set(), keys = [];
  for (const entry of value.keys) {
    if (!exactMembers(entry, ['kid', 'jwk'], ['continuity', 'created']) || !kidOk(entry.kid) || kids.has(entry.kid) || removed.includes(entry.kid)) return null;
    const jwk = entry.jwk;
    if (!plainObject(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !coordinate(jwk.x) || !coordinate(jwk.y) || (jwk.d !== undefined && !coordinate(jwk.d))) return null;
    if (points.has(`${jwk.x}.${jwk.y}`)) return null;
    if (entry.created !== undefined && (!Number.isSafeInteger(entry.created) || entry.created < 0)) return null;
    if (entry.continuity !== undefined) {
      const c = entry.continuity;
      // The signer is an earlier listed key, or a removed (compromised) one.
      if (!exactMembers(c, ['kid', 'sig']) || !kidOk(c.kid) || typeof c.sig !== 'string' || c.sig.length > 128 || (!kids.has(c.kid) && !removed.includes(c.kid))) return null;
    }
    kids.add(entry.kid); points.add(`${jwk.x}.${jwk.y}`);
    keys.push(Object.freeze({ kid: entry.kid, publicJwk: Object.freeze(publicOf(jwk)), ...entry.kid === value.current && jwk.d !== undefined ? { d: jwk.d } : {}, ...entry.continuity ? { continuity: Object.freeze({ kid: entry.continuity.kid, sig: entry.continuity.sig }) } : {}, ...entry.created !== undefined ? { created: entry.created } : {} }));
  }
  const current = keys.find(key => key.kid === value.current);
  if (!current?.d) return null;
  return Object.freeze({ current: value.current, keys: Object.freeze(keys), removed: Object.freeze([...removed]) });
}

const verified = new WeakMap();
/** Checks every continuity signature against its listed signer and that the current key chains (through listed keys)
 * to a root, or to a key whose signer was removed. Returns {ok, roots, resets, orphans, issues}. Cached per set. */
export async function verifyAttestationKeySet(set, { crypto = globalThis.crypto } = {}) {
  if (!set?.keys) return { ok: false, roots: [], resets: 0, orphans: [], issues: ['malformed'] };
  if (verified.has(set)) return verified.get(set);
  const byKid = new Map(set.keys.map(key => [key.kid, key])), issues = [], roots = [], orphans = [];
  const jwkOf = key => ({ ...key.publicJwk, kid: key.kid, ...key.continuity ? { continuity: key.continuity } : {} });
  for (const key of set.keys) {
    if (!key.continuity) { roots.push(await attestationKeyThumbprint(key.publicJwk, { crypto })); continue; }
    const signer = byKid.get(key.continuity.kid);
    if (!signer) { orphans.push(key.kid); continue; }
    if (!await verifyAttestationKeyContinuity({ signer: jwkOf(signer), next: jwkOf(key) }, { crypto })) issues.push(`continuity:${key.kid}`);
  }
  // The current key must reach a root or an orphan through verified links.
  let cursor = byKid.get(set.current), chained = false; const seen = new Set();
  for (;;) {
    if (!cursor || seen.has(cursor.kid)) break; seen.add(cursor.kid);
    if (!cursor.continuity) { chained = true; break; }
    const next = byKid.get(cursor.continuity.kid);
    if (!next) { chained = set.removed.includes(cursor.continuity.kid); break; }
    cursor = next;
  }
  if (!chained) issues.push('current-unchained');
  const result = Object.freeze({ ok: issues.length === 0, roots: Object.freeze(roots), resets: Math.max(0, roots.length - 1), orphans: Object.freeze(orphans), issues: Object.freeze(issues) });
  verified.set(set, result);
  return result;
}

/** The published JWKS (spec §5.1): every listed key with `kid`, `use:"sig"`, `alg:"ES256"` and `continuity`. */
export function publishedAttestationJwks(set) {
  if (!set?.keys) return null;
  return { keys: set.keys.map(key => ({ ...key.publicJwk, kid: key.kid, use: 'sig', alg: 'ES256', ...key.continuity ? { continuity: { ...key.continuity } } : {} })) };
}

/** An attestation signer over the set's current key, or null for an unusable configuration. The set is verified
 * before the first signature; a set that fails never signs (the PORT-2 commit holds and retries). */
export function attestorFromKeySet(set, { crypto: webCrypto = globalThis.crypto } = {}) {
  if (!set?.keys) return null;
  const current = set.keys.find(key => key.kid === set.current); if (!current?.d) return null;
  let imported;
  const ready = async () => {
    const check = await verifyAttestationKeySet(set, { crypto: webCrypto });
    if (!check.ok) throw Object.assign(new Error('The attestation key set does not verify.'), { code: 'attestation_keys_invalid' });
    return imported ??= webCrypto.subtle.importKey('jwk', { ...current.publicJwk, d: current.d }, P256, false, ['sign']);
  };
  return Object.freeze({ kid: set.current, async sign(payload) { return signMoveAttestation({ kid: set.current, payload }, await ready(), { crypto: webCrypto }); } });
}
/** `IDENTITY_ATTESTATION_KEYS` (or the legacy `IDENTITY_ATTESTATION_KEY`) to an attestor, or null. */
export const attestorFromConfig = (config, options) => attestorFromKeySet(parseAttestationKeySet(config), options);

/** Root thumbprints of a set (its keys without continuity). */
export async function attestationRootThumbprints(set, { crypto = globalThis.crypto } = {}) {
  if (!set?.keys) return [];
  return Promise.all(set.keys.filter(key => !key.continuity).map(key => attestationKeyThumbprint(key.publicJwk, { crypto })));
}
/** The verifier roots map for PORT-1 `evaluateAttestationKeys`: shipped roots, operator-configured roots and this
 * provider's own roots for its own issuer. A configured empty list means "never trust on first use" for that issuer. */
export async function attestationRoots({ issuer, set, configured = {}, shipped = SHIPPED_ATTESTATION_ROOTS } = {}, { crypto = globalThis.crypto } = {}) {
  const roots = {};
  for (const source of [shipped, configured]) for (const [name, list] of Object.entries(source ?? {})) if (httpsOrigin(name) && Array.isArray(list)) roots[name] = [...new Set([...(roots[name] ?? []), ...list.filter(value => typeof value === 'string')])];
  if (httpsOrigin(issuer) && set?.keys) roots[issuer] = [...new Set([...(roots[issuer] ?? []), ...await attestationRootThumbprints(set, { crypto })])];
  return roots;
}

// ---- operator tooling (and tests) -------------------------------------------------------------------------------

async function freshKey(crypto) {
  const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  const { x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { x, y, d, privateKey: pair.privateKey };
}
/** A new configuration with a single root key. */
export async function createAttestationKeySet({ kid, created, crypto = globalThis.crypto } = {}) {
  const key = await freshKey(crypto), id = kid ?? `att-${crypto.randomUUID()}`;
  return { v: 1, current: id, keys: [{ kid: id, jwk: { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, d: key.d }, ...created !== undefined ? { created } : {} }] };
}
/** Yearly rotation (spec §5.1): a fresh key vouched for by the current key, which becomes retired (its `d` dropped).
 * Takes and returns the configuration object (not the parsed set). */
export async function rotateAttestationKeySet(config, { kid, created, crypto = globalThis.crypto } = {}) {
  const set = parseAttestationKeySet(config); if (!set) throw new TypeError('Invalid attestation key configuration.');
  const current = set.keys.find(key => key.kid === set.current);
  const signer = await crypto.subtle.importKey('jwk', { ...current.publicJwk, d: current.d }, P256, false, ['sign']);
  const key = await freshKey(crypto), id = kid ?? `att-${crypto.randomUUID()}`, next = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
  const continuity = await signAttestationKeyContinuity({ kid: current.kid, privateKey: signer, next }, { crypto });
  return { v: 1, current: id, keys: [...set.keys.map(entry => ({ kid: entry.kid, jwk: { ...entry.publicJwk }, ...entry.continuity ? { continuity: { ...entry.continuity } } : {}, ...entry.created !== undefined ? { created: entry.created } : {} })), { kid: id, jwk: { ...next, d: key.d }, continuity, ...created !== undefined ? { created } : {} }], ...set.removed.length ? { removed: [...set.removed] } : {} };
}
/** Removes a compromised key from the published set (spec §5.1). The current key cannot be removed this way. */
export function removeAttestationKey(config, kid) {
  const parsed = typeof config === 'string' ? JSON.parse(config) : structuredClone(config);
  if (parsed.current === kid) throw new TypeError('Rotate away from the current attestation key before removing it.');
  const keys = parsed.keys.filter(entry => entry.kid !== kid); if (keys.length === parsed.keys.length) throw new TypeError('Unknown attestation key.');
  return { ...parsed, keys, removed: [...new Set([...(parsed.removed ?? []), kid])] };
}
