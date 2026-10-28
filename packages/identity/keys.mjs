// Core identity key registry (docs/architecture/messaging-extraction.md slice C0, formerly the key half of
// ContactTokenService). Engine-first: IdentityKeyRegistry is the provider resource, and the Actions/Queries below
// are the operations over it. Slice C3 (key-delegation.v1) signs delegation certificates with the current signing key.
//
// Every operation names its purpose; the only identity-key purpose is now signing (the separate ECDH encryption key had
// no consumer and was removed with recovery file v3, owner approval 2026-10-28, spike Q11). Legacy rows under
// `identity-encryption-key/`, `encryption-key`, `identity-key-retained/` and the recovery binding
// `identity-key-recovery/` are no longer read or written (dev data reset).
//   signing     ES256 (legacy registrations may be EdDSA). Public records keep the legacy `contact-key/<owner>/<kid>/`
//               prefix that contact tokens and endpoints read; the current private key is the `signing-key` pointer.
// States are monotonic: active -> retired -> revoked, or active -> revoked; never back.
//   active   exactly the pointer's key: signs new artifacts, and same-host lookups report it `active`.
//   retired  replaced by rotation. The record keeps `active: true`, so provider-stored artifacts it signed earlier
//            (contact grants, link metas, whose exact claims the provider holds) stay verifiable, but nothing can be
//            minted under them any more (no private key). Bearers minted from such a parent are new issuance and are
//            signed with the current key (PORT-9). Fresh-signature verifiers
//            (link responses, author proofs, delegation certificates, bearers) accept the current key only.
//   revoked  `active: false`: everything signed by it stops verifying. Revoking the current key clears its pointer;
//            the next ensure creates an unrelated key with no continuity, because a revoked key cannot vouch.
// Rotation continuity: the old signing key signs the new signing key. The statement is `{alg:'ES256', kid, payload, signature}` over
// UTF-8 `3sln-identity-key-continuity-v1.ES256.<kid>.<payload>`, payload = canonical base64url JSON.
// Custody is unchanged: private keys exist only as `seal`ed (KEY_ENCRYPTION_KEY) records and non-extractable
// imports; retired/revoked signing private keys are dropped. Never log key material.
// History is bounded per owner: signing prunes its oldest revoked record, then its oldest retired record
// that nothing still needs. Pinned records (a
// moved identity's imported keys, below) do not count against KEY_HISTORY_LIMIT: they are bounded by the portability
// byte budget instead (spec §7 "Size", checked at transfer-in intake), so 16 moves never fill the history. For an
// identity with pinned keys, every retired key on the continuity chain from the current key back to the pinned keys
// is never pruned either: spec §7 requires the chain from each statement signer to the current key to stay listed,
// and pruning one link would make the published `moves` unverifiable. Such an identity may keep own keys beyond
// KEY_HISTORY_LIMIT while its published document has headroom (64 keys and the §7 byte budget, computed from the arrival
// record `transfer-in/v1`); past that, rotation is refused with `key_history_full`.
//
// Tombstones. A pruned kid can never be registered or imported again (review finding 3). Pruned kids are kept as an
// exact set in pages of TOMBSTONE_PAGE kids (`identity-key-pruned/<owner>//<page>/`; the empty segment can never be a
// kid). Exact SHA-256-indexed membership rows live under `identity-key-pruned/<owner>//hash/`; stored kids disambiguate
// digest collisions. A transactional migration marker tracks the archive append page. Rows of the
// earlier one-row-per-kid layout (`identity-key-pruned/<owner>/<kid>/`) still count and are folded into the pages at
// the next prune. `retainedState` reports what an owner's key state retains.
//
// Old-key honouring (identity portability P11, PORT-9; docs/spec/identity-portability.md §7.1). Retired signing keys
// were once pinned while bound to an issued recovery file (P15) or named by a contact link; both references are gone
// (recovery file v3 holds no keys, 2026-10-28; contact links left the core in contacts phase 4), so retired keys are
// prunable under the ordinary policy. `referencedSigningKids` remains the seam for any future reference.
// Descriptors carry `created` and `retired` in Unix seconds (spec §7.1, AMD-P10) beside the millisecond fields.
//
// Custody fence (identity portability PORT-2/PORT-4). Nothing mints, exports or signs with a key for an owner whose
// identity moved away (`transfer-out/v1` committed, or `transfer-out/custody-ended-v1`), and nothing mints a key for an
// identity arriving by transfer-in before it is active (`transfer-in/v1` in any state but `active`): its keys come from
// the portable package (`importTransfer`), its only pre-activation signature is the move statement
// (`privateKey(..., {transferStatement: true})`), and its activation rotation is `rotateAtActivation`. Refusals are
// `identity_moved` and `transfer_in_pending`. Imported keys and their published history are `pinned`: never pruned,
// because the identity document must keep listing every key that signed a statement in `moves` (spec §7, §7.1).
import { Engine, Provider, Action, Query } from '../../vendor/ngin/index.js';
import { fail, key, canonical, base64url, fromBase64url, textEncoder, strictText, boundedString } from '../core/records.mjs';
import { MAX_DOCUMENT_KEYS, MAX_MOVES_DOCUMENT_BYTES, MOVE_KEY_ALLOWANCE } from './document-budget.mjs';
/** Headroom reserve for a moved identity's document header (`v`, `iss`, `sub`, `kind`, `handle`) and certification keys. */
const HEADER_CERT_BYTES = 4096, HEADER_CERT_KEYS = 4;

export const KEY_PURPOSES = Object.freeze(['signing']);
export const KEY_HISTORY_LIMIT = 16;
/** Pruned kids per tombstone page (see the header). */
export const TOMBSTONE_PAGE = 128;
/** Most published-history entries a transfer-in imports beside the arriving key (spec §7: at most 64 document keys). */
export const IMPORTED_HISTORY_LIMIT = 63;
export const REVOCATION_REASONS = Object.freeze(['unspecified', 'compromise', 'owner', 'superseded']);
export const CONTINUITY_DOMAIN = '3sln-identity-key-continuity-v1';
const PREFIX = { signing: 'contact-key' }, POINTER = { signing: 'signing-key' }, TOMBSTONE = 'identity-key-pruned';
export const TRANSFER_IN_ROTATION = 'transfer-in-activation';
/** Rows of the withdrawn encryption key and recovery binding; only custody destruction still deletes them. */
const LEGACY_RETAINED = 'identity-key-retained', LEGACY_ENCRYPTION_POINTER = 'encryption-key', LEGACY_BINDING = 'identity-key-recovery';
const TRANSFER_OUT_RECORD = 'transfer-out/v1', CUSTODY_ENDED = 'transfer-out/custody-ended-v1', TRANSFER_IN_RECORD = 'transfer-in/v1';
const STATEMENT_STATES = new Set(['posting', 'pending', 'decided']);
/** The custody fence (see the header): null when key operations may proceed, otherwise the refusal code. `statement`
 * admits the pre-activation statement signer; `activating` admits the activation rotation. */
export async function custodyFence(tx, { statement = false, activating = false } = {}) {
  if (await tx.get(CUSTODY_ENDED) !== undefined || (await tx.get(TRANSFER_OUT_RECORD))?.state === 'committed') return 'identity_moved';
  const incoming = await tx.get(TRANSFER_IN_RECORD);
  if (incoming && incoming.state !== 'active') { if (statement && STATEMENT_STATES.has(incoming.state) || activating && incoming.state === 'activating') return null; return 'transfer_in_pending'; }
  return null;
}
const fenced = async (tx, options) => { const code = await custodyFence(tx, options); if (code) fail(code, code === 'identity_moved' ? 'This identity moved to another provider.' : 'This identity is still arriving from another provider.'); };
export const IDENTITY_ALGORITHMS = Object.freeze(Object.assign(Object.create(null), { EdDSA: { name: 'Ed25519' }, ES256: { name: 'ECDSA', hash: 'SHA-256' } }));
export const importAlgorithm = alg => alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : IDENTITY_ALGORITHMS[alg];
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const purposeOf = purpose => KEY_PURPOSES.includes(purpose) ? purpose : fail('invalid_purpose');
const ownerOf = owner => boundedString(owner) ? owner : fail('invalid_key');
const publicPath = (purpose, owner, kid) => key(PREFIX[purpose], owner, kid);
// The public shape is constructed explicitly, so no private member (`d`) or usage hint ever reaches a record.
const publicOf = jwk => Object.fromEntries(['kty', 'crv', 'x', 'y'].filter(name => typeof jwk?.[name] === 'string').map(name => [name, jwk[name]]));
export const keyState = record => record?.state ?? (record?.active === true ? 'active' : 'revoked');

/** The public descriptor a lookup returns; `current` only for the pointer's key in state active. */
function describe(record, purpose, pointer) {
  const state = keyState(record);
  return { kid: record.kid, purpose, alg: record.alg, publicJwk: publicOf(record.publicJwk), state, current: state === 'active' && pointer?.kid === record.kid, verifiable: state !== 'revoked', createdAt: record.createdAt ?? null, retiredAt: record.retiredAt ?? null, revokedAt: record.revokedAt ?? null, created: seconds(record.createdAt), retired: seconds(record.retiredAt), predecessor: record.predecessor ?? null, successor: record.successor ?? null, continuity: record.continuity ?? null, rotation: record.rotation ?? null };
}
/** Unix seconds of a millisecond record time, or null (published `created`/`retired`, spec §7.1). */
export const seconds = ms => Number.isSafeInteger(ms) && ms >= 0 ? Math.floor(ms / 1000) : null;
/** Signing kids `owner` still needs at `now` (ms). Nothing references a retired key any more (see header), so this is
 * empty; kept as the single seam for future references. */
export async function referencedSigningKids(tx, owner, now) { return new Set(); }
/** The kids on the continuity chain from `currentKid` back through `predecessor` links among `records` (stops at a
 * missing or revoked link). Used to keep a moved identity's published chain intact (see the header). */
export function continuityChain(records, currentKid) {
  const byKid = new Map(records.map(record => [record.kid, record])), chain = new Set();
  for (let record = byKid.get(currentKid); record && !chain.has(record.kid) && keyState(record) !== 'revoked'; record = byKid.get(record.predecessor)) chain.add(record.kid);
  return chain;
}
const tombstonePages = owner => `${key(TOMBSTONE, owner)}/`, tombstonePage = (owner, page) => key(TOMBSTONE, owner, '', page);
/** Same-host signing record still usable for provider-stored artifacts (contact grants, link metas): active or retired. */
export async function verifiableSigningKey(tx, owner, kid) { const record = await tx.get(publicPath('signing', owner, kid)); return record?.active === true && keyState(record) !== 'revoked' ? record : null; }

const continuityInput = (kid, payload) => textEncoder.encode(`${CONTINUITY_DOMAIN}.ES256.${kid}.${payload}`);
/** Checks `next.continuity` against `signer` (a signing descriptor or record): the signer is the predecessor itself.
 * Pure. */
export async function verifyKeyContinuity({ signer, next, subject, crypto = globalThis.crypto }) {
  const proof = next?.continuity;
  // A revoked signer vouches for nothing (review finding 2): its private key may be in other hands.
  if (!proof || signer?.verifiable === false || keyState(signer) === 'revoked' || proof.alg !== 'ES256' || signer?.alg !== 'ES256' || proof.kid !== signer.kid || typeof proof.payload !== 'string' || typeof proof.signature !== 'string' || proof.payload.length > 4096) return false;
  let statement; try { statement = JSON.parse(strictText(fromBase64url(proof.payload))); } catch { return false; }
  const purpose = next.purpose ?? 'signing';
  if (statement?.version !== 1 || typeof statement.subject !== 'string' || (subject !== undefined && statement.subject !== subject) || !Number.isSafeInteger(statement.at) || (Number.isSafeInteger(signer.revokedAt) && statement.at >= signer.revokedAt) || statement.purpose !== purpose || statement.signer !== signer.kid || statement.previous !== next.predecessor || statement.next?.kid !== next.kid || statement.next.alg !== next.alg || canonical(statement.next.publicJwk) !== canonical(publicOf(next.publicJwk))) return false;
  if (purpose === 'signing' && statement.previous !== signer.kid) return false;
  try { const publicKey = await crypto.subtle.importKey('jwk', publicOf(signer.publicJwk), ECDSA, false, ['verify']); return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromBase64url(proof.signature), continuityInput(proof.kid, proof.payload)); } catch { return false; }
}

/** Verification-key lookup across hosts: same-host principals resolve through `local`; any other issuer goes to the
 * future directory profile hook (`directory.resolve`), and without one it is unverifiable (null), never trusted. */
export async function resolveIdentityKey({ issuer, subject, kid, purpose = 'signing' }, { issuer: localIssuer, local, directory } = {}) {
  purposeOf(purpose); if (!boundedString(subject) || !boundedString(kid) || typeof issuer !== 'string') return null;
  const found = issuer === localIssuer ? await local?.(subject, kid, purpose) : await directory?.resolve?.({ issuer, subject, kid, purpose });
  return found && found.purpose === purpose && found.kid === kid ? found : null;
}

export class IdentityKeyRegistry {
  /** `store`: the serializable transaction contract (`transaction(tx => {get,set,delete,list})`). `seal`/`open`
   * encrypt private JWKs at rest; only the private-key operations need them. */
  constructor({ store, seal, open, clock = () => Date.now(), crypto = globalThis.crypto, historyLimit = KEY_HISTORY_LIMIT }) {
    if (!store?.transaction || !Number.isSafeInteger(historyLimit) || historyLimit < 2) throw new TypeError('Invalid identity key registry');
    Object.assign(this, { store, seal, open, clock, crypto, historyLimit });
  }
  #sealing() { if (typeof this.seal !== 'function' || typeof this.open !== 'function') fail('identity_keys_unavailable'); }
  async #pointer(tx, owner, purpose) { const pointer = await tx.get(POINTER[purpose]); if (pointer && pointer.owner !== undefined && pointer.owner !== owner) fail('forbidden'); return pointer; }
  async #records(tx, owner, purpose) { return (await tx.list(key(PREFIX[purpose], owner))).map(row => row.value).filter(record => record?.owner === owner).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.kid).localeCompare(String(b.kid))); }
  // Records carry a per-owner, per-purpose sequence, so history order and pruning never depend on clock resolution.
  async #next(tx, owner, purpose) { return (await this.#records(tx, owner, purpose)).reduce((max, record) => Math.max(max, record.seq ?? 0), 0) + 1; }
  // Makes room for one more record within the bounded history (see the header). Pinned records do not count.
  async #admit(tx, owner, purpose, keep, protect = []) {
    const records = await this.#records(tx, owner, purpose), own = records.filter(record => record.pinned !== true); if (own.length < this.historyLimit) return;
    // A revoked record is pruned first, so a revocation can always be followed by a replacement (review finding 1).
    // Signing then prunes the oldest retired record nothing references (P11): a referenced one is never dropped, nor,
    // for a moved identity, a link of the continuity chain its published `moves` need (spec §7).
    const moved = purpose === 'signing' && own.length !== records.length;
    const chain = moved ? continuityChain(records, (await this.#pointer(tx, owner, purpose))?.kid) : new Set();
    const prunable = own.filter(record => record.kid !== keep && keyState(record) !== 'active' && !(keyState(record) === 'retired' && chain.has(record.kid)));
    let victim = prunable.find(record => keyState(record) === 'revoked');
    if (!victim && purpose === 'signing') { const referenced = await referencedSigningKids(tx, owner, this.clock()); for (const kid of protect) referenced.add(kid); victim = prunable.find(record => !referenced.has(record.kid)); }
    // A moved identity may keep own keys beyond KEY_HISTORY_LIMIT (the 16 keys of the §7 base are a reserve, not a
    // ceiling) while its published document keeps real headroom: 64 keys and the byte budget (review 2026-10-23, item 3).
    const fits = victim && own.length - 1 < this.historyLimit || moved && await this.#headroom(tx, records.filter(record => record !== victim));
    if (!fits) fail('key_history_full');
    if (!victim) return;
    // A pruned kid is tombstoned for good, so it can never be registered again (review finding 3).
    await this.#tombstone(tx, owner, victim.kid);
    await tx.delete(publicPath(purpose, owner, victim.kid));
  }
  /** Whether a moved identity's published document still fits spec §7 "Size" with one more signing key: its `moves`
   * (the arrival record `transfer-in/v1`: the source's records and this host's statement and attestation), every
   * remaining signing key as published, the new key at MOVE_KEY_ALLOWANCE, and a reserve for the header and
   * certification keys; and at most MAX_DOCUMENT_KEYS keys. No arrival record: no headroom (fail closed). */
  async #headroom(tx, remaining) {
    const arrival = await tx.get(TRANSFER_IN_RECORD);
    if (arrival?.state !== 'active' || typeof arrival.statement?.jws !== 'string') return false;
    if (remaining.length + 1 + HEADER_CERT_KEYS > MAX_DOCUMENT_KEYS) return false;
    const moves = [...Array.isArray(arrival.sourceMoves) ? arrival.sourceMoves : [], { statement: arrival.statement.jws, attestation: arrival.attestation ?? null }];
    const size = value => textEncoder.encode(JSON.stringify(value)).length + 1;
    const published = record => ({ kid: record.kid, use: 'sig', alg: record.alg, jwk: publicOf(record.publicJwk), state: keyState(record) === 'active' ? 'retired' : keyState(record), created: Number.MAX_SAFE_INTEGER, retired: Number.MAX_SAFE_INTEGER, predecessor: record.predecessor ?? null, continuity: record.continuity ?? null });
    const bytes = HEADER_CERT_BYTES + MOVE_KEY_ALLOWANCE + remaining.reduce((sum, record) => sum + size(published(record)), 0) + moves.reduce((sum, record) => sum + size({ statement: record.statement, attestation: record.attestation ?? null }), 0);
    return bytes <= MAX_MOVES_DOCUMENT_BYTES;
  }
  // ---- tombstones (see the header) ----
  // Reserved empty-segment hash/state rows share the excluded tombstone family. Exact membership
  // needs one bounded read, while
  // archive pages retain the compact, inspectable history. SHA-256 collisions remain exact by
  // comparing the stored kids, rather than treating a digest as proof of membership.
  async #hashPath(owner, kid) { return key(TOMBSTONE, owner, '', 'hash', base64url(new Uint8Array(await this.crypto.subtle.digest('SHA-256', textEncoder.encode(kid))))); }
  async #indexPruned(tx, owner, kid) {
    const path = await this.#hashPath(owner, kid), row = await tx.get(path);
    if (!row?.kids?.includes(kid)) await tx.set(path, { kids: [...(row?.kids ?? []), kid] });
  }
  async #tombstoneState(tx, owner) {
    const path = key(TOMBSTONE, owner, '', 'state'), ready = await tx.get(path);
    if (ready) return ready;
    // One atomic migration of both earlier formats. No security lookup may skip old pages
    // until the complete exact index and append pointer have committed together.
    const rows = await tx.list(key(TOMBSTONE, owner)), pages = rows.filter(row => row.value?.owner === owner && Array.isArray(row.value.kids)).sort((a,b) => a.value.page-b.value.page);
    let page = pages.at(-1)?.value ?? { owner, page: 0, kids: [] };
    const seen = new Set();
    for (const row of pages) for (const name of row.value.kids) { seen.add(name); await this.#indexPruned(tx, owner, name); }
    for (const row of rows) if (typeof row.value?.kid === 'string' && !Array.isArray(row.value.kids)) {
      const name = row.value.kid;
      if (!seen.has(name)) {
        if (page.kids.length >= TOMBSTONE_PAGE) { await tx.set(tombstonePage(owner, page.page), page); page = { owner, page: page.page + 1, kids: [] }; }
        page = { ...page, kids: [...page.kids, name] }; seen.add(name); await this.#indexPruned(tx, owner, name);
      }
      await tx.delete(row.key);
    }
    if (page.kids.length) await tx.set(tombstonePage(owner, page.page), page);
    const state = { page: page.page }; await tx.set(path, state); return state;
  }
  async #pruned(tx, owner, kids) {
    // Preserve immediate exact denial for the original one-row-per-kid layout.
    for (const kid of kids) if (await tx.get(key(TOMBSTONE, owner, kid))) return true;
    await this.#tombstoneState(tx, owner);
    for (const kid of kids) if ((await tx.get(await this.#hashPath(owner, kid)))?.kids?.includes(kid)) return true;
    return false;
  }
  async #tombstone(tx, owner, kid) {
    const state = await this.#tombstoneState(tx, owner), path = await this.#hashPath(owner, kid);
    if ((await tx.get(path))?.kids?.includes(kid)) return;
    let page = await tx.get(tombstonePage(owner, state.page)) ?? { owner, page: state.page, kids: [] };
    if (page.kids.length >= TOMBSTONE_PAGE) page = { owner, page: page.page + 1, kids: [] };
    await tx.set(tombstonePage(owner, page.page), { ...page, kids: [...page.kids, kid], at: this.clock() });
    await this.#indexPruned(tx, owner, kid);
    if (page.page !== state.page) await tx.set(key(TOMBSTONE, owner, '', 'state'), { page: page.page });
  }
  async #generate(purpose) {
    purposeOf(purpose);
    const pair = await this.crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    const publicJwk = publicOf(await this.crypto.subtle.exportKey('jwk', pair.publicKey));
    return { kid: this.crypto.randomUUID(), alg: 'ES256', publicJwk, encrypted: await this.seal(await this.crypto.subtle.exportKey('jwk', pair.privateKey)) };
  }
  async #importPrivate(purpose, jwk) { purposeOf(purpose); return this.crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['sign']); }

  /** Legacy public-only signing registration. Caller must have freshly authenticated the owner and confirmed key custody. */
  async register(owner, { kid, alg, publicJwk } = {}) {
    if (!boundedString(owner) || !boundedString(kid) || !IDENTITY_ALGORITHMS[alg] || !publicJwk || typeof publicJwk !== 'object' || Object.hasOwn(publicJwk, 'd')) fail('invalid_key');
    const clean = publicOf(publicJwk);
    try { await this.crypto.subtle.importKey('jwk', clean, importAlgorithm(alg), false, ['verify']); } catch { fail('invalid_key'); }
    return this.store.transaction(async tx => {
      const path = publicPath('signing', owner, kid);
      await fenced(tx);
      if (await tx.get(path) || await this.#pruned(tx, owner, [kid])) fail('key_exists');
      await this.#admit(tx, owner, 'signing', (await this.#pointer(tx, owner, 'signing'))?.kid);
      await tx.set(path, { owner, kid, alg, publicJwk: clean, active: true, purpose: 'signing', state: 'active', custody: 'external', createdAt: this.clock(), seq: await this.#next(tx, owner, 'signing') });
      return { kid, alg };
    });
  }
  /** Idempotently provides the owner's current key of `purpose`. A legacy pointer without a public record is backfilled. */
  async ensure(owner, purpose) {
    ownerOf(owner); purposeOf(purpose); this.#sealing();
    const [existing, published] = await this.store.transaction(async tx => {
      await fenced(tx);
      let pointer = await this.#pointer(tx, owner, purpose); const record = pointer && await tx.get(publicPath(purpose, owner, pointer.kid));
      // A pointer left on a revoked record (the pre-C0 revokeKey kept it) is dropped, never signed with (review finding 6).
      if (record && keyState(record) === 'revoked') { await tx.delete(POINTER[purpose]); pointer = undefined; }
      else if (pointer && pointer.owner === undefined) { pointer = { ...pointer, owner, purpose }; await tx.set(POINTER[purpose], pointer); }
      return [pointer, Boolean(record)];
    });
    if (existing) {
      if (published) return { kid: existing.kid, created: false };
      const publicJwk = publicOf(await this.open(existing.encrypted));
      return this.store.transaction(async tx => {
        const pointer = await this.#pointer(tx, owner, purpose); if (pointer?.kid !== existing.kid) fail('key_conflict');
        if (!await tx.get(publicPath(purpose, owner, existing.kid))) { await this.#admit(tx, owner, purpose, existing.kid); await tx.set(publicPath(purpose, owner, existing.kid), { owner, kid: existing.kid, alg: 'ES256', publicJwk, active: true, purpose, state: 'active', createdAt: this.clock(), seq: await this.#next(tx, owner, purpose) }); }
        return { kid: existing.kid, created: false };
      });
    }
    // Generated outside the transaction; a concurrent winner's key is kept and this one is discarded unstored.
    const fresh = await this.#generate(purpose);
    return this.store.transaction(async tx => {
      await fenced(tx);
      const pointer = await this.#pointer(tx, owner, purpose); if (pointer) return { kid: pointer.kid, created: false };
      const now = this.clock();
      // A registry-held record left active without its pointer has no private key any more: it is retired, without a
      // successor link (nothing vouched). Externally registered keys are never current and keep their state (finding 5).
      for (const record of await this.#records(tx, owner, purpose)) if (keyState(record) === 'active' && record.custody !== 'external') await tx.set(publicPath(purpose, owner, record.kid), { ...record, state: 'retired', retiredAt: now });
      await this.#admit(tx, owner, purpose, fresh.kid);
      await tx.set(publicPath(purpose, owner, fresh.kid), { owner, kid: fresh.kid, alg: fresh.alg, publicJwk: fresh.publicJwk, active: true, purpose, state: 'active', createdAt: now, seq: await this.#next(tx, owner, purpose) });
      await tx.set(POINTER[purpose], { kid: fresh.kid, owner, purpose, encrypted: fresh.encrypted });
      return { kid: fresh.kid, created: true };
    });
  }
  /** Replaces the current key of `purpose` (compare-and-set on `expectedKid`) and records signed continuity. */
  async rotate(owner, { purpose, expectedKid } = {}) { return this.#rotate(owner, { purpose, expectedKid }); }
  /** PORT-4 (P11, spec §7.1): the destination's rotation at activation, in the activating state only. The imported key
   * signs the continuity statement naming a fresh key and becomes `retired` (never `revoked` because of the move) and
   * stays pinned in the published history. Idempotent: an already-rotated owner whose current key's predecessor is
   * `expectedKid` gets the existing result. */
  async rotateAtActivation(owner, { expectedKid } = {}) {
    ownerOf(owner); if (!boundedString(expectedKid)) fail('invalid_key');
    const done = await this.store.transaction(async tx => { const pointer = await this.#pointer(tx, owner, 'signing'), record = pointer && await tx.get(publicPath('signing', owner, pointer.kid)); return pointer && pointer.kid !== expectedKid && record?.predecessor === expectedKid ? { kid: pointer.kid, previous: expectedKid, purpose: 'signing' } : null; });
    return done ?? this.#rotate(owner, { purpose: 'signing', expectedKid, activation: true });
  }
  async #rotate(owner, { purpose, expectedKid, activation = false } = {}) {
    ownerOf(owner); purposeOf(purpose); this.#sealing(); if (!boundedString(expectedKid)) fail('invalid_key');
    const [current, signing] = await this.store.transaction(async tx => [await this.#pointer(tx, owner, purpose), await this.#pointer(tx, owner, 'signing')]);
    if (!current) fail('not_found'); if (current.kid !== expectedKid) fail('key_conflict'); if (!signing) fail('identity_keys_unavailable');
    const fresh = await this.#generate(purpose), at = this.clock(), signer = signing.kid;
    const payload = base64url(textEncoder.encode(canonical({ version: 1, subject: owner, purpose, previous: expectedKid, signer, next: { kid: fresh.kid, alg: fresh.alg, publicJwk: fresh.publicJwk }, at })));
    const signature = base64url(new Uint8Array(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await this.#importPrivate('signing', await this.open(signing.encrypted)), continuityInput(signer, payload))));
    return this.store.transaction(async tx => {
      const pointer = await this.#pointer(tx, owner, purpose), signingNow = await this.#pointer(tx, owner, 'signing'), old = await tx.get(publicPath(purpose, owner, expectedKid));
      // Anything that moved since the reads above (a concurrent rotation or revocation) invalidates this statement.
      if (pointer?.kid !== expectedKid || signingNow?.kid !== signer || !old || keyState(old) !== 'active' || keyState(await tx.get(publicPath('signing', owner, signer))) !== 'active') fail('key_conflict');
      await fenced(tx, { activating: activation });
      await this.#admit(tx, owner, purpose, expectedKid);
      const now = this.clock();
      await tx.set(publicPath(purpose, owner, expectedKid), { ...old, state: 'retired', retiredAt: now, successor: fresh.kid, ...activation ? { pinned: true } : {} });
      await tx.set(publicPath(purpose, owner, fresh.kid), { owner, kid: fresh.kid, alg: fresh.alg, publicJwk: fresh.publicJwk, active: true, purpose, state: 'active', createdAt: now, seq: await this.#next(tx, owner, purpose), predecessor: expectedKid, continuity: { alg: 'ES256', kid: signer, payload, signature }, ...activation ? { rotation: TRANSFER_IN_ROTATION } : {} });
      await tx.set(POINTER[purpose], { kid: fresh.kid, owner, purpose, encrypted: fresh.encrypted });
      return { kid: fresh.kid, previous: expectedKid, purpose };
    });
  }
  /** Revokes one key of `purpose` (idempotent). Revoking the current key clears its pointer in the same transaction. */
  async revoke(owner, { purpose, kid, reason = 'unspecified' } = {}) {
    ownerOf(owner); purposeOf(purpose); if (!boundedString(kid) || !REVOCATION_REASONS.includes(reason)) fail('invalid_key');
    return this.store.transaction(async tx => {
      const path = publicPath(purpose, owner, kid), record = await tx.get(path), pointer = await this.#pointer(tx, owner, purpose);
      if (!record || record.owner !== owner) fail('not_found');
      if (keyState(record) !== 'revoked' || record.active !== false) {
        const revoked = { ...record, active: false, state: 'revoked', revokedAt: record.revokedAt ?? this.clock(), reason: record.reason ?? reason };
        await tx.set(path, revoked); Object.assign(record, revoked);
      }
      if (pointer?.kid === kid) await tx.delete(POINTER[purpose]);
      return describe(record, purpose, null);
    });
  }
  /** PORT-4 intake: stores a portable package's private keys under this provider's custody, with the source's published
   * signing-key history (public only). Only while `transfer-in/v1` exists and is not active. `input`:
   * {signing:{kid, jwk, predecessor?, continuity?, created?}, encryption?:{kid, jwk}, history:[{kid, publicJwk, state,
   * created?, retired?, revoked?, predecessor?, continuity?}]}; times in Unix seconds as published. A package's
   * `encryption` key is validated for shape and then discarded: identity encryption keys were removed (2026-10-28) and
   * this dormant path is withdrawn in phase 2 of the recovery and transfer spike. Idempotent for the same keys;
   * anything else already present is `key_conflict`. Never logs or returns key material. */
  async importTransfer(owner, input = {}) {
    ownerOf(owner); this.#sealing();
    const signing = input.signing, encryption = input.encryption ?? null, history = input.history ?? [];
    const point = jwk => ({ kty: 'EC', crv: 'P-256', x: jwk?.x, y: jwk?.y });
    const ok = (entry, d) => entry && boundedString(entry.kid) && typeof entry.jwk?.x === 'string' && typeof entry.jwk?.y === 'string' && (!d || typeof entry.jwk.d === 'string');
    if (!ok(signing, true) || (encryption && !ok(encryption, true)) || !Array.isArray(history) || history.length > IMPORTED_HISTORY_LIMIT) fail('invalid_key');
    for (const entry of history) if (!boundedString(entry?.kid) || typeof entry.publicJwk?.x !== 'string' || !['retired', 'revoked'].includes(entry.state) || entry.kid === signing.kid) fail('invalid_key');
    if (new Set([signing.kid, ...history.map(entry => entry.kid), ...encryption ? [encryption.kid] : []]).size !== history.length + 1 + (encryption ? 1 : 0)) fail('invalid_key');
    const ms = value => Number.isSafeInteger(value) && value >= 0 ? value * 1000 : undefined;
    const sealedSigning = await this.seal({ kty: 'EC', crv: 'P-256', x: signing.jwk.x, y: signing.jwk.y, d: signing.jwk.d });
    return this.store.transaction(async tx => {
      const incoming = await tx.get(TRANSFER_IN_RECORD);
      if (!incoming || incoming.state === 'active') fail('transfer_in_pending', 'Keys arrive only with a pending transfer.');
      if (await custodyFence(tx) === 'identity_moved') fail('identity_moved', 'This identity moved to another provider.');
      const pointer = await this.#pointer(tx, owner, 'signing'), stored = pointer && await tx.get(publicPath('signing', owner, pointer.kid));
      if (pointer) { if (pointer.kid === signing.kid && stored?.publicJwk?.x === signing.jwk.x && stored.publicJwk.y === signing.jwk.y) return { kid: pointer.kid, imported: false }; fail('key_conflict'); }
      const existing = await this.#records(tx, owner, 'signing');
      if (existing.some(record => record.kid !== signing.kid && !history.some(entry => entry.kid === record.kid))) fail('key_conflict');
      if (await this.#pruned(tx, owner, [signing.kid, ...history.map(entry => entry.kid)])) fail('key_exists');
      let seq = await this.#next(tx, owner, 'signing');
      for (const entry of history) await tx.set(publicPath('signing', owner, entry.kid), { owner, kid: entry.kid, alg: 'ES256', publicJwk: point(entry.publicJwk), active: entry.state !== 'revoked', purpose: 'signing', state: entry.state, createdAt: ms(entry.created), ...entry.state === 'retired' ? { retiredAt: ms(entry.retired) } : { revokedAt: ms(entry.revoked) }, seq: seq++, predecessor: entry.predecessor ?? null, ...entry.continuity ? { continuity: structuredClone(entry.continuity) } : {}, custody: 'history', pinned: true });
      await tx.set(publicPath('signing', owner, signing.kid), { owner, kid: signing.kid, alg: 'ES256', publicJwk: point(signing.jwk), active: true, purpose: 'signing', state: 'active', createdAt: ms(signing.created) ?? this.clock(), seq: seq++, predecessor: signing.predecessor ?? null, ...signing.continuity ? { continuity: structuredClone(signing.continuity) } : {}, custody: 'imported', pinned: true });
      await tx.set(POINTER.signing, { kid: signing.kid, owner, purpose: 'signing', encrypted: sealedSigning });
      return { kid: signing.kid, imported: true };
    });
  }
  /** PORT-4: custody ends for a transfer-in that will never activate (refused, cancelled, failed). Public records stay
   * for audit; pointers are deleted, and so are any legacy retained encryption keys and recovery binding rows. */
  async destroyCustody(owner) {
    ownerOf(owner);
    return this.store.transaction(async tx => {
      for (const purpose of KEY_PURPOSES) { const pointer = await this.#pointer(tx, owner, purpose); if (pointer) await tx.delete(POINTER[purpose]); }
      for (const { key: path } of await tx.list(key(LEGACY_RETAINED, owner))) await tx.delete(path);
      await tx.delete(LEGACY_ENCRYPTION_POINTER); await tx.delete(key(LEGACY_BINDING, owner));
      return { destroyed: true };
    });
  }
  /** Public descriptor of `kid` under `purpose`, or null. */
  async lookup(owner, { purpose, kid } = {}) {
    purposeOf(purpose); if (!boundedString(owner) || !boundedString(kid)) return null;
    return this.store.transaction(async tx => { const record = await tx.get(publicPath(purpose, owner, kid)); return record?.owner === owner ? describe(record, purpose, await this.#pointer(tx, owner, purpose)) : null; });
  }
  async current(owner, { purpose } = {}) {
    purposeOf(purpose); ownerOf(owner);
    return this.store.transaction(async tx => { const pointer = await this.#pointer(tx, owner, purpose), record = pointer && await tx.get(publicPath(purpose, owner, pointer.kid)); return record ? describe(record, purpose, pointer) : null; });
  }
  /** Retained-state accounting for `owner` (rows and the counts that drive them; no key material): signing records
   * (own, pinned) and tombstones (kids, pages, legacy rows not yet folded). Read-only. */
  async retainedState(owner) {
    ownerOf(owner);
    return this.store.transaction(async tx => {
      const signing = await this.#records(tx, owner, 'signing');
      const pages = (await tx.list(tombstonePages(owner))).filter(row => row.value?.owner === owner && Array.isArray(row.value.kids));
      const legacy = (await tx.list(key(TOMBSTONE, owner))).filter(row => typeof row.value?.kid === 'string' && !Array.isArray(row.value?.kids));
      return { signing: { records: signing.length, pinned: signing.filter(record => record.pinned === true).length, own: signing.filter(record => record.pinned !== true).length, limit: this.historyLimit },
        tombstones: { kids: pages.reduce((sum, row) => sum + row.value.kids.length, 0) + legacy.length, pages: pages.length, legacy: legacy.length, rows: pages.length + legacy.length } };
    });
  }
  /** Bounded history, oldest first. */
  async history(owner, { purpose } = {}) {
    purposeOf(purpose); ownerOf(owner);
    return this.store.transaction(async tx => { const pointer = await this.#pointer(tx, owner, purpose); return (await this.#records(tx, owner, purpose)).map(record => describe(record, purpose, pointer)); });
  }
  /** The current private key, imported non-extractable for signing only, or null. */
  async privateKey(owner, purpose, { transferStatement = false } = {}) {
    ownerOf(owner); purposeOf(purpose); this.#sealing();
    const pointer = await this.store.transaction(async tx => { await fenced(tx, { statement: transferStatement === true && purpose === 'signing' }); const found = await this.#pointer(tx, owner, purpose); return found && keyState(await tx.get(publicPath(purpose, owner, found.kid)) ?? { active: true }) !== 'revoked' ? found : null; });
    return pointer ? { kid: pointer.kid, privateKey: await this.#importPrivate(purpose, await this.open(pointer.encrypted)) } : null;
  }
}

// Engine operations. `owner` is the authenticated principal the caller speaks for; nothing else is copied in.
class KeyAction extends Action {
  static deps = ['identityKeys'];
  constructor({ owner, input } = {}) { super(); this.owner = owner; this.input = input ?? {}; }
  async execute({ identityKeys }, { dispatchFeed, engineFeed }) {
    const value = await this.run(identityKeys);
    dispatchFeed.dispatchEvent(new CustomEvent('result', { detail: value }));
    engineFeed.dispatchEvent(new CustomEvent('identity-keys-changed', { detail: { owner: this.owner, purpose: this.input.purpose ?? 'signing' } }));
  }
}
/** `input`: {purpose}. */
export class EnsureIdentityKey extends KeyAction { run(keys) { return keys.ensure(this.owner, this.input.purpose); } }
/** `input`: {purpose, expectedKid}. */
export class RotateIdentityKey extends KeyAction { run(keys) { return keys.rotate(this.owner, this.input); } }
/** `input`: {purpose, kid, reason?}. */
export class RevokeIdentityKey extends KeyAction { run(keys) { return keys.revoke(this.owner, this.input); } }
/** `input`: {kid, alg, publicJwk}; legacy public-only signing registration. */
export class RegisterIdentityKey extends KeyAction { run(keys) { return keys.register(this.owner, this.input); } }
class KeyQuery extends Query {
  static deps = ['identityKeys'];
  constructor({ owner, input } = {}) { super(); this.owner = owner; this.input = input ?? {}; }
}
/** `input`: {purpose, kid}. */
export class IdentityKeyByKid extends KeyQuery { fetch({ identityKeys }) { return identityKeys.lookup(this.owner, this.input); } }
/** `input`: {purpose}. */
export class CurrentIdentityKey extends KeyQuery { fetch({ identityKeys }) { return identityKeys.current(this.owner, this.input); } }
/** `input`: {purpose}. */
export class IdentityKeyHistory extends KeyQuery { fetch({ identityKeys }) { return identityKeys.history(this.owner, this.input); } }
/** Retained-state accounting (`retainedState`). */
export class IdentityKeyRetainedState extends KeyQuery { fetch({ identityKeys }) { return identityKeys.retainedState(this.owner); } }

/** An engine over one registry (or the resources to build one); `engine.identityKeys` is that registry. */
export function createIdentityKeyEngine(resources) {
  const registry = resources instanceof IdentityKeyRegistry ? resources : new IdentityKeyRegistry(resources);
  return Object.assign(new Engine({ providers: { identityKeys: Provider.fromSingleton(registry) } }), { identityKeys: registry });
}
/** Dispatches a key Action and resolves with its result once the dispatch completed; rejects with what it threw. */
export async function performKeyAction(engine, action) {
  const feed = engine.dispatch(action); let result;
  feed.addEventListener('result', event => { result = event; }, { once: true });
  await feed.next('complete');
  if (!result) throw new Error(`${action.constructor.name} completed without a result`);
  return result.detail;
}
export const readKeyQuery = (engine, query) => engine.query(query).peek();
