// Identity portability codec and verification (docs/spec/identity-portability.md rev 3.2; design slice PORT-1).
// Pure: no storage, no network, no engine. WebCrypto is injectable through `{crypto}` options. Everything that needs
// a fetch (spec §8.3 items 4 and 5, manifests, attestation JWKS freshness) is the caller's; the functions here verify
// what can be verified offline and return the facts a caller needs (origin principal, chain head, aep, pins).
//
//   Move statement (§4)       signMoveStatement / parseMoveStatement / verifyMoveStatement, statementDigest
//   Move attestation (§5.3)   signMoveAttestation / parseMoveAttestation / verifyMoveAttestation
//   Linkage (§8.3 item 2)     verifyMoveRecordLink(previous|null, statement)
//   Chain (§8.6, §8.3 1–3)    verifyChain({moves, keys, iss, identity, attestationKeys, pins, roots})
//   Attestation keys (§5.1)   attestationKeyThumbprint, sign/verifyAttestationKeyContinuity, evaluateAttestationKeys
//   Package (§9.1)            validatePackage / verifyPackage
//   Redirects (§5.2, §10)     validateRedirectBase, redirectablePath, redirectTarget, originalURL
//
// JWS profile (links §3.1): strict I-JSON, exact members, received-bytes signing input, 64-byte raw ES256 signature.
// Signers encode header and payload canonically (sorted members), as links do.
//
// Assumption (organizations §3a.3 is the key format, but leaves the in-memory shape to implementations): `keys` is
// the identity document's signing-key list, each `{kid, alg:'ES256', jwk|publicJwk, state:'active'|'retired'|'revoked',
// created?, retired?, predecessor?, continuity?}`. Continuity statements are exactly packages/identity/keys.mjs's
// (domain `3sln-identity-key-continuity-v1`, signed by the predecessor) and are checked with its verifyKeyContinuity.
// A statement in `moves` verifies under a key of the lineage that continuity links to the single `active` key; a
// retired key qualifies because `moves` statements are anchored artefacts (§7.1 case 2), a revoked key never does.
// Statement keys must be non-decreasing along that lineage as `seq` grows: a later move signed by an ancestor of an
// earlier move's key would be a rolled-back key (organizations §3a.4).
import { base64url, fromBase64url, textEncoder, canonical, boundedString } from '../core/records.mjs';
import { strictJSON, exactMembers, plainObject } from '../links/envelope.mjs';
import { UUID } from '../core/primitives.mjs';
import { verifyKeyContinuity } from './keys.mjs';

export const MOVE_TYP = 'bindle-identity-move+jwt';
export const ATTESTATION_TYP = 'bindle-move-attestation+jwt';
export const ATTESTATION_KEY_CONTINUITY_DOMAIN = 'bindle-attestation-key-continuity-v1';
export const MAX_MOVES = 16, MAX_PACKAGE_BYTES = 8192, MAX_MOVES_DOCUMENT_BYTES = 32768;
const MAX_JWS = 8192, MAX_URL = 2048;

export class SuccessionError extends Error {
  constructor(code, message = 'The identity move record could not be verified.') { super(message); this.code = code; }
}
const fail = (code, message) => { throw new SuccessionError(code, message); };
const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const SEGMENTS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DIGEST = /^sha256-[A-Za-z0-9_-]{43}$/;
const safeTime = value => Number.isSafeInteger(value) && value >= 0;
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const encodeSegment = value => base64url(textEncoder.encode(canonical(value)));

// ---- primitives -------------------------------------------------------------------------------------------------

/** An HTTPS origin exactly (no path, no trailing slash). */
export const httpsOrigin = value => { try { const url = new URL(value); return typeof value === 'string' && value.length <= 256 && url.protocol === 'https:' && url.origin === value; } catch { return false; } };
/** An identity URI on `origin`: canonical HTTPS URL without userinfo, query or fragment. */
const identityOn = (value, origin) => { try { const url = new URL(value); return typeof value === 'string' && value.length <= MAX_URL && url.href === value && url.protocol === 'https:' && url.origin === origin && !url.username && !url.password && !url.search && !url.hash && !value.includes('?') && !value.includes('#'); } catch { return false; } };
const place = value => exactMembers(value, ['iss', 'identity']) && httpsOrigin(value.iss) && identityOn(value.identity, value.iss);
const samePlace = (a, b) => a?.iss === b?.iss && a?.identity === b?.identity;
/** Public P-256 coordinates, 32 bytes each. */
const coordinate = value => { try { return typeof value === 'string' && fromBase64url(value).length === 32; } catch { return false; } };
const publicOf = jwk => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
const publicP256 = jwk => plainObject(jwk) && jwk.kty === 'EC' && jwk.crv === 'P-256' && coordinate(jwk.x) && coordinate(jwk.y) && !Object.hasOwn(jwk, 'd');

/** `sha256-` + unpadded base64url SHA-256 of the ASCII signing input (`segment1 "." segment2`). */
export async function statementDigest(input, { crypto = globalThis.crypto } = {}) {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input)) fail('statement_invalid');
  return `sha256-${base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(input))))}`;
}

// Canonical ES256 signatures (review L1): ECDSA (r, s) and (r, n−s) both verify, so anyone could re-encode a published
// record into a byte-different one with the same digest, which §8.4 would read as equivocation. Signers here always emit
// low-s (s ≤ n/2) and parsers and verifiers refuse high-s, so each signed record has exactly one accepted encoding.
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n, HALF_N = N >> 1n;
const sOf = signature => BigInt('0x' + [...signature.slice(32)].map(b => b.toString(16).padStart(2, '0')).join(''));
/** True for a 64-byte raw ES256 signature whose s is in [1, n/2] (the canonical low-s form). */
export const lowS = signature => signature?.length === 64 && (s => s >= 1n && s <= HALF_N)(sOf(signature));
const toLowS = signature => { const s = sOf(signature); if (s <= HALF_N) return signature; const flipped = (N - s).toString(16).padStart(64, '0'), out = new Uint8Array(64); out.set(signature.slice(0, 32)); for (let i = 0; i < 32; i++) out[32 + i] = parseInt(flipped.slice(2 * i, 2 * i + 2), 16); return out; };
const canonicalSign = async (privateKey, bytes, crypto) => toLowS(new Uint8Array(await crypto.subtle.sign(ES256, privateKey, bytes)));
function parseJWS(value, typ, code) {
  try {
    if (typeof value !== 'string' || value.length > MAX_JWS || !SEGMENTS.test(value)) fail(code);
    const [h, p, s] = value.split('.');
    const header = strictJSON(utf8(fromBase64url(h))), payload = strictJSON(utf8(fromBase64url(p))), signature = fromBase64url(s);
    if (!exactMembers(header, ['alg', 'kid', 'typ']) || header.alg !== 'ES256' || header.typ !== typ || !boundedString(header.kid, 128) || /[\u0080-\u009f]/.test(header.kid) || !lowS(signature) || !plainObject(payload)) fail(code);
    return { header, payload, input: `${h}.${p}`, signature, value };
  } catch (error) { if (error instanceof SuccessionError) throw error; fail(code); }
}
async function importPublic(publicJwk, crypto) { if (!publicP256(publicJwk)) return null; try { return await crypto.subtle.importKey('jwk', publicOf(publicJwk), P256, false, ['verify']); } catch { return null; } }
async function verifyBytes(publicJwk, signature, bytes, crypto) { const key = await importPublic(publicJwk, crypto); if (!key) return false; try { return await crypto.subtle.verify(ES256, key, signature, bytes); } catch { return false; } }
async function signJWS(header, payload, privateKey, crypto) {
  const input = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  return `${input}.${base64url(await canonicalSign(privateKey, textEncoder.encode(input), crypto))}`;
}

// ---- move statement (§4) ----------------------------------------------------------------------------------------

const STATEMENT = ['bindle', 'v', 'sub', 'kind', 'seq', 'prev', 'from', 'to', 'iat'];
function statementPayload(payload) {
  if (!exactMembers(payload, STATEMENT) || payload.bindle !== 'identity-move' || payload.v !== 1 || typeof payload.sub !== 'string' || !UUID.test(payload.sub) || !['person', 'organization'].includes(payload.kind)) fail('statement_invalid');
  if (!Number.isSafeInteger(payload.seq) || payload.seq < 1 || (payload.seq === 1 ? payload.prev !== null : typeof payload.prev !== 'string' || !DIGEST.test(payload.prev))) fail('statement_invalid');
  if (!place(payload.from) || !place(payload.to) || payload.from.iss === payload.to.iss || !safeTime(payload.iat)) fail('statement_invalid');
  return payload;
}
export async function signMoveStatement({ kid, payload }, privateKey, { crypto = globalThis.crypto } = {}) {
  if (!boundedString(kid, 128)) fail('statement_invalid');
  statementPayload(payload);
  const value = await signJWS({ alg: 'ES256', kid, typ: MOVE_TYP }, payload, privateKey, crypto);
  parseMoveStatement(value); return value;
}
export function parseMoveStatement(jws) { const parsed = parseJWS(jws, MOVE_TYP, 'statement_invalid'); statementPayload(parsed.payload); return parsed; }
/** Parses and verifies under `publicJwk` (the key the header's kid names). */
export async function verifyMoveStatement(jws, publicJwk, { crypto = globalThis.crypto } = {}) {
  const parsed = typeof jws === 'string' ? parseMoveStatement(jws) : parseMoveStatement(jws?.value);
  if (!await verifyBytes(publicJwk, parsed.signature, textEncoder.encode(parsed.input), crypto)) fail('statement_invalid');
  return parsed;
}

// ---- move attestation (§5.3) ------------------------------------------------------------------------------------

const ATTESTATION = ['bindle', 'v', 'iss', 'sub', 'seq', 'statement', 'to', 'aep', 'at'];
function attestationPayload(payload) {
  if (!exactMembers(payload, ATTESTATION) || payload.bindle !== 'move-attestation' || payload.v !== 1 || !httpsOrigin(payload.iss) || typeof payload.sub !== 'string' || !UUID.test(payload.sub) || !Number.isSafeInteger(payload.seq) || payload.seq < 1 || typeof payload.statement !== 'string' || !DIGEST.test(payload.statement) || !place(payload.to) || !safeTime(payload.aep) || !safeTime(payload.at)) fail('attestation_invalid');
  return payload;
}
export async function signMoveAttestation({ kid, payload }, privateKey, { crypto = globalThis.crypto } = {}) {
  if (!boundedString(kid, 128)) fail('attestation_invalid');
  attestationPayload(payload);
  const value = await signJWS({ alg: 'ES256', kid, typ: ATTESTATION_TYP }, payload, privateKey, crypto);
  parseMoveAttestation(value); return value;
}
export function parseMoveAttestation(jws) { const parsed = parseJWS(jws, ATTESTATION_TYP, 'attestation_invalid'); attestationPayload(parsed.payload); return parsed; }
/** Verifies `jws` over `statement` (parsed or compact) under the attestation key `publicJwk`. Matching is §8.3 item 3. */
export async function verifyMoveAttestation(jws, { statement, publicJwk } = {}, { crypto = globalThis.crypto } = {}) {
  const parsed = parseMoveAttestation(jws), stated = typeof statement === 'string' ? parseMoveStatement(statement) : parseMoveStatement(statement?.value);
  const { payload } = parsed, s = stated.payload;
  if (payload.iss !== s.from.iss || payload.sub !== s.sub || payload.seq !== s.seq || !samePlace(payload.to, s.to) || payload.statement !== await statementDigest(stated.input, { crypto })) fail('attestation_invalid');
  if (!await verifyBytes(publicJwk, parsed.signature, textEncoder.encode(parsed.input), crypto)) fail('attestation_invalid');
  return parsed;
}

/** §8.3 item 2 against the previous verified statement (null for the first move). */
export async function verifyMoveRecordLink(previous, parsed, { crypto = globalThis.crypto } = {}) {
  const s = parsed?.payload; if (!s) fail('chain_invalid');
  if (previous === null || previous === undefined) { if (s.seq !== 1 || s.prev !== null) fail('chain_invalid'); return true; }
  const p = previous.payload;
  if (s.seq !== p.seq + 1 || s.sub !== p.sub || s.kind !== p.kind || !samePlace(s.from, p.to) || s.prev !== await statementDigest(previous.input, { crypto })) fail('chain_invalid');
  return true;
}

// ---- attestation keys (§5.1, P16) -------------------------------------------------------------------------------

/** RFC 7638 SHA-256 thumbprint of an EC P-256 public key, unpadded base64url. */
export async function attestationKeyThumbprint(publicJwk, { crypto = globalThis.crypto } = {}) {
  if (!plainObject(publicJwk) || publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256' || !coordinate(publicJwk.x) || !coordinate(publicJwk.y)) fail('attestation_invalid');
  const members = `{"crv":"P-256","kty":"EC","x":"${publicJwk.x}","y":"${publicJwk.y}"}`;
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(members))));
}
const continuityBytes = thumbprint => textEncoder.encode(`${ATTESTATION_KEY_CONTINUITY_DOMAIN}.${thumbprint}`);
export async function signAttestationKeyContinuity({ kid, privateKey, next }, { crypto = globalThis.crypto } = {}) {
  if (!boundedString(kid, 128)) fail('attestation_invalid');
  const signature = await canonicalSign(privateKey, continuityBytes(await attestationKeyThumbprint(next, { crypto })), crypto);
  return { kid, sig: base64url(signature) };
}
/** True when `next.continuity` is a valid signature by `signer` (a listed key, with its kid) over next's thumbprint. */
export async function verifyAttestationKeyContinuity({ signer, next }, { crypto = globalThis.crypto } = {}) {
  const proof = next?.continuity;
  if (!exactMembers(proof, ['kid', 'sig']) || typeof signer?.kid !== 'string' || proof.kid !== signer.kid || signer.kid === next.kid) return false;
  let signature; try { signature = fromBase64url(proof.sig); } catch { return false; }
  if (!lowS(signature)) return false;
  let thumbprint; try { thumbprint = await attestationKeyThumbprint(next, { crypto }); } catch { return false; }
  return verifyBytes(signer, signature, continuityBytes(thumbprint), crypto);
}
function attestationJwks(jwks) {
  const keys = Array.isArray(jwks) ? jwks : jwks?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 64) fail('attestation_invalid');
  const kids = new Set();
  for (const key of keys) {
    if (!exactMembers(key, ['kty', 'crv', 'x', 'y', 'kid', 'use', 'alg'], ['continuity']) || !publicP256(key) || key.use !== 'sig' || key.alg !== 'ES256' || !boundedString(key.kid, 128) || kids.has(key.kid)) fail('attestation_invalid');
    kids.add(key.kid);
  }
  return keys;
}
const pinOf = (pins, issuer) => { const pin = pins?.[issuer]; return pin && Array.isArray(pin.thumbprints) ? { thumbprints: [...pin.thumbprints], firstUse: pin.firstUse === true } : null; };
/** §5.1 pinning. Returns the trusted thumbprints among the listed keys, the updated pin map (input untouched),
 * whether this evaluation pinned on first use, and whether it is an attestation reset (nothing listed is pinned or
 * chained to a pin). Preconfigured `roots` are never pinned on first use. */
export async function evaluateAttestationKeys({ issuer, jwks, pins = {}, roots = {} }, { crypto = globalThis.crypto } = {}) {
  if (!httpsOrigin(issuer)) fail('attestation_invalid');
  const keys = attestationJwks(jwks), byKid = new Map(keys.map(key => [key.kid, key]));
  const prints = new Map(); for (const key of keys) prints.set(key.kid, await attestationKeyThumbprint(key, { crypto }));
  const chained = async key => key.continuity !== undefined && byKid.has(key.continuity?.kid) && await verifyAttestationKeyContinuity({ signer: byKid.get(key.continuity.kid), next: key }, { crypto });
  const existing = pinOf(pins, issuer), configured = Array.isArray(roots?.[issuer]) ? roots[issuer] : null;
  const trusted = new Set(); let firstUse = false;
  if (!existing && !configured) {
    // First use: every listed key that is a root (no continuity) or chains to another listed key.
    for (const key of keys) if (key.continuity === undefined || await chained(key)) trusted.add(prints.get(key.kid));
    firstUse = trusted.size > 0;
  } else {
    const base = new Set([...(existing?.thumbprints ?? []), ...(configured ?? [])]);
    for (const key of keys) if (base.has(prints.get(key.kid))) trusted.add(prints.get(key.kid));
    // Closure: a key is trusted when its continuity signer is a trusted listed key.
    for (let changed = true; changed;) { changed = false; for (const key of keys) { const print = prints.get(key.kid); if (trusted.has(print) || key.continuity === undefined) continue; const signer = byKid.get(key.continuity.kid); if (signer && trusted.has(prints.get(signer.kid)) && await chained(key)) { trusted.add(print); changed = true; } } }
  }
  const reset = trusted.size === 0, next = { ...pins };
  if (!reset) next[issuer] = { thumbprints: [...new Set([...(existing?.thumbprints ?? []), ...trusted])], firstUse: existing ? existing.firstUse : firstUse };
  return { trusted: [...trusted], pins: next, firstUse, reset };
}

// ---- chain (§8.6, §8.3 items 1–3) -------------------------------------------------------------------------------

function keySet(keys, subject) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 64) fail('chain_invalid');
  const byKid = new Map();
  for (const key of keys) {
    const publicJwk = key?.publicJwk ?? key?.jwk;
    if (!plainObject(key) || !boundedString(key.kid, 128) || key.alg !== 'ES256' || (key.use !== undefined && key.use !== 'sig') || !publicP256(publicJwk) || !['active', 'retired', 'revoked'].includes(key.state) || byKid.has(key.kid)) fail('chain_invalid');
    byKid.set(key.kid, { kid: key.kid, alg: 'ES256', purpose: 'signing', publicJwk: publicOf(publicJwk), state: key.state, verifiable: key.state !== 'revoked', predecessor: key.predecessor ?? null, continuity: key.continuity ?? null, ...(safeTime(key.revoked) ? { revokedAt: key.revoked } : {}) });
  }
  const active = [...byKid.values()].filter(key => key.state === 'active');
  if (active.length !== 1) fail('chain_invalid');
  return { byKid, active: active[0], subject };
}
/** The continuity lineage ending at the active key, oldest first. A revoked signer vouches for nothing. */
async function lineage({ byKid, active, subject }) {
  const order = [active], seen = new Set([active.kid]);
  for (let cur = active; cur.predecessor !== null;) {
    const signer = byKid.get(cur.continuity?.kid);
    if (!signer || signer.kid !== cur.predecessor || seen.has(signer.kid) || signer.state === 'active' || !await verifyKeyContinuity({ signer, next: cur, subject })) break;
    order.unshift(signer); seen.add(signer.kid); cur = signer;
  }
  return order;
}
/** The continuity lineage of an identity document's signing keys, oldest first, ending at its single `active` key
 * (PORT-5 adoption and PORT-4 intake reuse the PORT-1 walk). Each entry is a normalized descriptor with `publicJwk`.
 * Throws `chain_invalid` for a malformed key list or one without exactly one active key. */
export async function documentLineage(keys, subject) { return lineage(keySet(keys, subject)); }
/** First-contact verification of a successor chain (§8.6) with §8.3 items 1–3 per record. Items 4 and 5 (destination
 * directory and "the source has let go") need fetches and stay with the caller. `attestationKeys(issuer)` returns
 * that issuer's attestation JWKS (fetched or cached under §5.1) or undefined. */
export async function verifyChain({ moves, keys, iss, identity, attestationKeys, pins = {}, roots = {} } = {}, { crypto = globalThis.crypto } = {}) {
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_MOVES || typeof attestationKeys !== 'function' || !httpsOrigin(iss)) fail('chain_invalid');
  if (moves.some(record => !exactMembers(record, ['statement', 'attestation']))) fail('chain_invalid');
  const statements = moves.map(record => parseMoveStatement(record.statement)), sub = statements[0].payload.sub;
  const set = keySet(keys, sub), order = await lineage(set), index = new Map(order.map((key, i) => [key.kid, i]));
  let previous = null, floor = 0, pinState = { ...pins }, firstUse = false, aep = 0;
  for (let i = 0; i < moves.length; i++) {
    const parsed = statements[i];
    await verifyMoveRecordLink(previous, parsed, { crypto });
    const position = index.get(parsed.header.kid);
    if (position === undefined || position < floor) fail('chain_invalid');
    floor = position;
    await verifyMoveStatement(parsed.value, order[position].publicJwk, { crypto }).catch(() => fail('chain_invalid'));
    if (moves[i].attestation === null) fail('chain_invalid', 'An unattested move is never adopted automatically.');
    const source = parsed.payload.from.iss, jwks = await attestationKeys(source);
    if (jwks === undefined || jwks === null) fail('chain_invalid', 'Attestation keys are unavailable.');
    const evaluated = await evaluateAttestationKeys({ issuer: source, jwks, pins: pinState, roots }, { crypto });
    if (evaluated.reset) fail('attestation_reset');
    const attestation = parseMoveAttestation(moves[i].attestation), listed = attestationJwks(jwks).find(key => key.kid === attestation.header.kid);
    if (!listed || !evaluated.trusted.includes(await attestationKeyThumbprint(listed, { crypto }))) fail('attestation_untrusted');
    await verifyMoveAttestation(moves[i].attestation, { statement: parsed, publicJwk: listed }, { crypto }).catch(() => fail('chain_invalid'));
    pinState = evaluated.pins; firstUse ||= evaluated.firstUse; aep = attestation.payload.aep; previous = parsed;
  }
  if (!samePlace(previous.payload.to, { iss, identity })) fail('chain_invalid');
  return { origin: { iss: statements[0].payload.from.iss, sub }, kind: statements[0].payload.kind, head: { seq: previous.payload.seq, digest: await statementDigest(previous.input, { crypto }) }, aep, pins: pinState, attestation_first_use: firstUse };
}

// ---- portable identity package (§9.1) ---------------------------------------------------------------------------

function privateJwk(value, purpose) {
  const optional = ['alg', 'use', 'key_ops', 'ext'];
  if (!exactMembers(value, ['kty', 'crv', 'x', 'y', 'd'], optional) || value.kty !== 'EC' || value.crv !== 'P-256' || !coordinate(value.x) || !coordinate(value.y) || !coordinate(value.d)) fail('package_invalid');
  if (value.alg !== undefined && value.alg !== (purpose === 'signing' ? 'ES256' : 'ECDH-ES')) fail('package_invalid');
  if (value.use !== undefined && value.use !== (purpose === 'signing' ? 'sig' : 'enc')) fail('package_invalid');
  if (value.ext !== undefined && typeof value.ext !== 'boolean') fail('package_invalid');
  if (value.key_ops !== undefined) { const allowed = purpose === 'signing' ? ['sign'] : ['deriveKey', 'deriveBits']; if (!Array.isArray(value.key_ops) || value.key_ops.length > allowed.length || new Set(value.key_ops).size !== value.key_ops.length || value.key_ops.some(op => !allowed.includes(op))) fail('package_invalid'); }
}
/** Structural §9.1 check; accepts the object or its JSON text. Returns a clean structured clone. */
export function validatePackage(input) {
  let value = input;
  if (typeof input === 'string') { if (textEncoder.encode(input).length > MAX_PACKAGE_BYTES) fail('package_invalid'); try { value = strictJSON(input); } catch { fail('package_invalid'); } }
  if (!plainObject(value)) fail('package_invalid');
  let text; try { text = JSON.stringify(value); } catch { fail('package_invalid'); }
  if (textEncoder.encode(text).length > MAX_PACKAGE_BYTES) fail('package_invalid');
  if (!exactMembers(value, ['bindle', 'v', 'sub', 'kind', 'from', 'keys'], ['transfer']) || value.bindle !== 'identity-package' || value.v !== 1 || typeof value.sub !== 'string' || !UUID.test(value.sub) || !['person', 'organization'].includes(value.kind) || !place(value.from)) fail('package_invalid');
  if (!exactMembers(value.keys, ['signing'], ['encryption'])) fail('package_invalid');
  for (const purpose of ['signing', 'encryption']) { const entry = value.keys[purpose]; if (entry === undefined && purpose === 'encryption') continue; if (!exactMembers(entry, ['kid', 'jwk']) || !boundedString(entry.kid, 128)) fail('package_invalid'); privateJwk(entry.jwk, purpose); }
  const { signing, encryption } = value.keys;
  if (encryption && (signing.kid === encryption.kid || signing.jwk.d === encryption.jwk.d || (signing.jwk.x === encryption.jwk.x && signing.jwk.y === encryption.jwk.y))) fail('package_invalid');
  if (value.transfer !== undefined && (!exactMembers(value.transfer, ['id', 'exp']) || typeof value.transfer.id !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value.transfer.id) || !safeTime(value.transfer.exp))) fail('package_invalid');
  return structuredClone(value);
}
/** validatePackage plus private/public correspondence for every key (an ECDSA proof over a random challenge, which
 * also proves the P-256 scalar of the ECDH key matches its point; recovery identity "Recovery wire schema"). */
export async function verifyPackage(input, { crypto = globalThis.crypto } = {}) {
  const value = validatePackage(input);
  for (const entry of [value.keys.signing, value.keys.encryption].filter(Boolean)) {
    const { kty, crv, x, y, d } = entry.jwk;
    try {
      const priv = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, P256, false, ['sign']), pub = await crypto.subtle.importKey('jwk', { kty, crv, x, y }, P256, false, ['verify']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      if (!await crypto.subtle.verify(ES256, pub, await crypto.subtle.sign(ES256, priv, challenge), challenge)) fail('package_invalid');
    } catch (error) { if (error instanceof SuccessionError) throw error; fail('package_invalid'); }
  }
  return value;
}

// ---- redirects (§5.2, §10) --------------------------------------------------------------------------------------

const ENCODED_UNSAFE = /%(2f|5c|2e)/i;
const PCHAR_SEGMENT = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;
const QUERY = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2})*$/;
const cleanSegments = path => { if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_URL || path.includes('\\') || ENCODED_UNSAFE.test(path)) return false; const segments = path.slice(1).split('/'); return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..' && PCHAR_SEGMENT.test(segment)); };
/** §5.2: HTTPS on exactly `destinationOrigin`, canonical, no query/fragment/userinfo, no dot or empty segments, no
 * percent-encoded `/`, `\` or `.`, path ending in `/`. Returns the base or throws `redirect_invalid`. */
export function validateRedirectBase(base, destinationOrigin) {
  if (typeof base !== 'string' || base.length > MAX_URL || !httpsOrigin(destinationOrigin) || base.includes('?') || base.includes('#') || base.includes('\\') || ENCODED_UNSAFE.test(base)) fail('redirect_invalid');
  let url; try { url = new URL(base); } catch { fail('redirect_invalid'); }
  if (url.href !== base || url.protocol !== 'https:' || url.origin !== destinationOrigin || url.username || url.password || !url.pathname.endsWith('/')) fail('redirect_invalid');
  if (url.pathname !== '/' && !cleanSegments(url.pathname.slice(0, -1))) fail('redirect_invalid');
  return base;
}
/** §10: a request path (as received) and raw query (null when the request had no `?`) that a source may redirect. */
export function redirectablePath(path, rawQuery = null) {
  if (!cleanSegments(path)) return false;
  if (rawQuery === null || rawQuery === undefined) return true;
  return typeof rawQuery === 'string' && rawQuery.length <= MAX_URL && QUERY.test(rawQuery);
}
/** `redirect_base` + path without its leading `/` + `?` + raw query, byte for byte. */
export function redirectTarget({ redirectBase, path, rawQuery = null }) {
  if (typeof redirectBase !== 'string' || !redirectBase.endsWith('/') || !redirectablePath(path, rawQuery)) fail('redirect_invalid');
  return `${redirectBase}${path.slice(1)}${rawQuery === null || rawQuery === undefined ? '' : `?${rawQuery}`}`;
}
/** The destination's reconstruction of the original URL: `from.iss` + the suffix under `redirectBase`. */
export function originalURL({ fromIss, redirectBase, target }) {
  if (!httpsOrigin(fromIss) || typeof redirectBase !== 'string' || !redirectBase.endsWith('/') || typeof target !== 'string' || target.length > 2 * MAX_URL || !target.startsWith(redirectBase)) fail('redirect_invalid');
  const suffix = target.slice(redirectBase.length), mark = suffix.indexOf('?');
  const path = `/${mark < 0 ? suffix : suffix.slice(0, mark)}`, rawQuery = mark < 0 ? null : suffix.slice(mark + 1);
  if (suffix.includes('#') || !redirectablePath(path, rawQuery)) fail('redirect_invalid');
  return `${fromIss}${path}${rawQuery === null ? '' : `?${rawQuery}`}`;
}
