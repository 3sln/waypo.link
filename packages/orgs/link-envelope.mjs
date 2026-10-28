// The Organizations link envelope (docs/spec/extensions/organizations-link-envelope.md; contacts spike CR-C2, provisional,
// unsigned): the `bindle_meta` raw-query parser, the meta parser, signature verification over the exact received bytes,
// and the meta signer. Moved unchanged in behaviour from packages/links/envelope.mjs, which contacts phase 4 deleted with
// the contact link type, audiences, `bindle_data` responses and the replay digest (CL-3). Organization and relation
// invitations are its only users. Pure functions, no I/O.
//
// Why this is not rebuilt over packages/core/signed-object.mjs: the verifier (annex §3.1, §3.2) still accepts EdDSA and
// high-S ES256 signatures, for stored legacy metas, and the signer encodes segments canonically, while the core
// signed-object module is ES256-only, low-S on both sides and encodes in member order. Rebuilding would change verdicts
// for stored invitations; the strict-JSON and exact-member rules already come from packages/core/strict-json.mjs.
// Recorded as a CR-C2 divergence. Issuance follows the annex §3.1 issuance rule (2026-10-28 review, CR-C2 verdict):
// ES256 only, normalized to low-S after WebCrypto signing (which may return either S). Single use is keyed on `jti`
// and the exact stored bytes, so a high-S twin of a stored meta is refused, never counted twice.
import { fail, base64url, fromBase64url, textEncoder, boundedString, canonical } from '../core/records.mjs';
import { strictIJSON as strictJSON, plainObject, exactMembers } from '../core/strict-json.mjs';
import { normalizeLowS } from '../core/signed-object.mjs';

export const LINK_META_TYP = 'bindle-link-meta+jwt';
export const LINK_LIMITS = Object.freeze({ meta: 4096, data: 2048, target: 8192 });
const VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// Keeps a leading BOM so strictJSON rejects it: no alternative encodings of the same JSON.
const utf8 = bytes => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('invalid_utf8'); } };
const asciiLower = value => value.replace(/[A-Z]/g, char => char.toLowerCase());
// WHATWG percent-decode: invalid sequences such as %zz stay literal.
const percentDecode = value => {
  const bytes = textEncoder.encode(value), out = [];
  for (let i = 0; i < bytes.length; i++) {
    const hex = bytes[i] === 37 && i + 2 < bytes.length ? String.fromCharCode(bytes[i+1], bytes[i+2]) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; } else out.push(bytes[i]);
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(out));
};

/** Annex §2: the one raw-query parser. Returns {form:'none'}, {form:'legacy'} (a `sig` parameter alone), or
 * {form:'link', meta, data?}; throws `link_malformed`. `bindle_data` is returned so callers can refuse it (annex §4). */
export function parseLinkQuery(target) {
  if (typeof target !== 'string' || target.length > 18000) fail('link_malformed');
  const base = target.split('#')[0], start = base.indexOf('?'), raw = start < 0 ? '' : base.slice(start + 1);
  let meta, data, legacy = false, bindle = false;
  for (const component of raw.split('&')) {
    if (!component) continue;
    const eq = component.indexOf('='), name = eq < 0 ? component : component.slice(0, eq), decoded = asciiLower(percentDecode(name));
    if (decoded === 'sig') { legacy = true; continue; }
    if (!decoded.startsWith('bindle_')) continue;
    bindle = true;
    const value = eq < 0 ? '' : component.slice(eq + 1);
    if ((name !== 'bindle_meta' && name !== 'bindle_data') || !VALUE.test(value)) fail('link_malformed');
    if (name === 'bindle_meta') { if (meta !== undefined) fail('link_malformed'); meta = value; }
    else { if (data !== undefined) fail('link_malformed'); data = value; }
  }
  if (legacy && bindle) fail('link_malformed');
  if (legacy) return { form: 'legacy' };
  if (!bindle) return { form: 'none' };
  if (meta === undefined || meta.length > LINK_LIMITS.meta || (data !== undefined && data.length > LINK_LIMITS.data) || target.length > LINK_LIMITS.target) fail('link_malformed');
  return data === undefined ? { form: 'link', meta } : { form: 'link', meta, data };
}

const httpsURI = (value, max = 256) => { try { const url = new URL(value); return typeof value === 'string' && value.length <= max && url.protocol === 'https:' && !url.username && !url.password && url.href === value; } catch { return false; } };
// Canonical audience: origin plus path, no query, fragment or userinfo. Plain HTTP only for localhost development.
const audienceURL = value => { try { const url = new URL(value); return typeof value === 'string' && value.length <= 2048 && url.href === value && !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')); } catch { return false; } };
const exactOrigin = value => { try { const url = new URL(value); return typeof value === 'string' && url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')); } catch { return false; } };
const safeTime = value => Number.isSafeInteger(value) && value >= 0;
const COMMON = ['bindle', 'v', 'type', 'iss', 'aud', 'jti', 'iat', 'exp'];

/** Annex §3: the meta's profile, header and common claims. Claims are returned for type-specific exact-member checks;
 * nothing here verifies a signature. Throws `link_invalid`. */
export function parseLinkMeta(value) {
  try {
    if (typeof value !== 'string' || value.length > LINK_LIMITS.meta || !VALUE.test(value)) fail('link_invalid');
    const [h, p, s] = value.split('.');
    const header = strictJSON(utf8(fromBase64url(h))), claims = strictJSON(utf8(fromBase64url(p))), signature = fromBase64url(s);
    if (!exactMembers(header, ['alg', 'kid', 'typ']) || !['ES256', 'EdDSA'].includes(header.alg) || header.typ !== LINK_META_TYP || !boundedString(header.kid) || /[\u0080-\u009f]/.test(header.kid) || signature.length !== 64) fail('link_invalid');
    if (!plainObject(claims) || !COMMON.every(name => Object.hasOwn(claims, name)) || claims.bindle !== 'link-meta' || claims.v !== 1 || !httpsURI(claims.type) || !audienceURL(claims.aud) || !safeTime(claims.iat) || !safeTime(claims.exp)) fail('link_invalid');
    if (!exactOrigin(claims.iss) || !boundedString(claims.jti) || claims.iat >= claims.exp) fail('link_invalid');
    return { header, claims, input: `${h}.${p}`, signature, value };
  } catch { fail('link_invalid'); }
}

const algorithms = { ES256: [{ name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }], EdDSA: [{ name: 'Ed25519' }, { name: 'Ed25519' }] };
/** Verifies the exact received signing input; never re-serializes JSON. Never throws. */
export async function verifyLinkSignature(crypto, parsed, { alg, publicJwk }) {
  if (!algorithms[alg] || parsed?.header?.alg !== alg) return false;
  try { return await crypto.subtle.verify(algorithms[alg][1], await crypto.subtle.importKey('jwk', publicJwk, algorithms[alg][0], false, ['verify']), parsed.signature, textEncoder.encode(parsed.input)); }
  catch { return false; }
}

// Header and claims are canonically encoded, so the stored signing input is exactly what verifiers receive.
const encodeSegment = value => base64url(textEncoder.encode(canonical(value)));
/** Signs a meta: header exactly {alg, kid, typ: LINK_META_TYP}. */
export async function signLinkJWS({ header, claims, privateKey, crypto = globalThis.crypto }) {
  // Issuance is ES256 only (EdDSA issuance dropped; EdDSA metas already stored still verify).
  if (!exactMembers(header, ['alg', 'kid', 'typ']) || header.alg !== 'ES256' || header.typ !== LINK_META_TYP || !boundedString(header.kid) || !plainObject(claims)) fail('invalid_token');
  const input = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = await crypto.subtle.sign(algorithms.ES256[1], privateKey, textEncoder.encode(input));
  return `${input}.${base64url(normalizeLowS(new Uint8Array(signature)))}`;
}
