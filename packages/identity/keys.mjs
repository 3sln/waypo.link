// Core identity key registry (docs/architecture/messaging-extraction.md slice C0, formerly the key half of
// ContactTokenService). Engine-first: IdentityKeyRegistry is the provider resource, and the Actions/Queries below
// are the operations over it. Slice C3 (key-delegation.v1) signs delegation certificates with the current signing key.
//
// Purposes are separated by construction: every operation names its purpose, and each purpose has its own record
// prefix, key algorithm and private-key usage. A kid looked up under one purpose never resolves under the other.
//   signing     ES256 (legacy registrations may be EdDSA). Public records keep the legacy `contact-key/<owner>/<kid>/`
//               prefix that contact tokens and endpoints read; the current private key is the `signing-key` pointer.
//   encryption  ECDH-ES P-256. Public records `identity-encryption-key/<owner>/<kid>/`; pointer `encryption-key`.
// States are monotonic: active -> retired -> revoked, or active -> revoked; never back.
//   active   exactly the pointer's key: signs new artifacts, and same-host lookups report it `active`.
//   retired  replaced by rotation. The record keeps `active: true`, so provider-stored artifacts it signed earlier
//            (contact grants, link metas, whose exact claims the provider holds) stay verifiable, but nothing can be
//            minted under them any more (no private key). Bearers minted from such a parent are new issuance and are
//            signed with the current key (PORT-9; packages/messaging/contact-endpoints.mjs). Fresh-signature verifiers
//            (link responses, author proofs, delegation certificates, bearers) accept the current key only.
//   revoked  `active: false`: everything signed by it stops verifying. Revoking the current key clears its pointer;
//            the next ensure creates an unrelated key with no continuity, because a revoked key cannot vouch.
// Rotation continuity: the old signing key signs the new signing key; the current signing key signs a new
// encryption key (an ECDH key cannot sign). The statement is `{alg:'ES256', kid, payload, signature}` over
// UTF-8 `3sln-identity-key-continuity-v1.ES256.<kid>.<payload>`, payload = canonical base64url JSON.
// Custody is unchanged: private keys exist only as `seal`ed (KEY_ENCRYPTION_KEY) records and non-extractable
// imports; retired/revoked signing private keys are dropped, and encryption private keys are retained sealed
// (`identity-key-retained/<owner>/<kid>/`), because old content may still need them. Never log key material.
// History is bounded per owner and purpose: signing prunes its oldest revoked record, then its oldest retired record
// that nothing still needs; encryption never prunes and refuses rotation with `key_history_full`. Pinned records (a
// moved identity's imported keys, below) do not count against KEY_HISTORY_LIMIT: they are bounded by the portability
// byte budget instead (spec §7 "Size", checked at transfer-in intake), so 16 moves never fill the history. For an
// identity with pinned keys, every retired key on the continuity chain from the current key back to the pinned keys
// is never pruned either: spec §7 requires the chain from each statement signer to the current key to stay listed,
// and pruning one link would make the published `moves` unverifiable. Such an identity may keep own keys beyond
// KEY_HISTORY_LIMIT while its published document has headroom (64 keys and the §7 byte budget, computed from the arrival
// record `transfer-in/v1`); past that, rotation is refused with `key_history_full`. The active-account recovery reissue
// then refuses with `rotation_unavailable` (identity/service.mjs) instead of issuing a file with the same key.
//
// Tombstones. A pruned kid can never be registered or imported again (review finding 3). Pruned kids are kept as an
// exact set in pages of TOMBSTONE_PAGE kids (`identity-key-pruned/<owner>//<page>/`; the empty segment can never be a
// kid), so the anti-reuse check stays exact while the row count grows by one per TOMBSTONE_PAGE prunes. Rows of the
// earlier one-row-per-kid layout (`identity-key-pruned/<owner>/<kid>/`) still count and are folded into the pages at
// the next prune. `retainedState` reports what an owner's key state retains.
//
// Old-key honouring (identity portability P11, PORT-9; docs/spec/identity-portability.md §7.1). A retired signing key
// is never pruned while it is *referenced*: named by a live stored record whose exact header the provider re-serves
// (`contact-grant/<jti>/` parents, active and unexpired, by `header.kid` or `endpoint.header.kid`; `link/<jti>/`
// records, unrevoked and unexpired, by `header.kid`), or bound to an issued recovery file (below). When every
// non-current record is referenced, a signing rotation refuses with `key_history_full` and changes nothing.
// Descriptors carry `created` and `retired` in Unix seconds (spec §7.1, AMD-P10) beside the millisecond fields.
//
// Rotation at recovery-file issuance (P15, PORT-10). `rotateForRecovery` rotates the signing key (ordinary continuity,
// the new record tagged `rotation: 'recovery-issuance'`) when the current key is in a file that may still be used:
// one of `rotateIf` (the kids the identity record binds to its current and resume credentials), or `always` for a
// legacy identity that never recorded one. It then merges into the recovery binding `identity-key-recovery/<owner>/`:
// `keep`, the outgoing kid (a lost identity CAS leaves its file current, review M1) and the resulting current kid,
// keeping at most RECOVERY_BINDING_LIMIT kids (oldest trimmed first, never the ones just named; review M2). A bound retired key still restores its file (`recoveryMatch`), because the
// identity commit that binds a credential to a key runs after this account commit and may lose its race; a bound key
// is never pruned. Any other signing rotation clears the binding (a rotation outside issuance makes older files
// unusable), and revoking a key removes it. A full history of referenced keys skips the rotation and reports
// `skipped: 'key_history_full'` (design §2.5: a known edge, audited by the caller).
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

export const KEY_PURPOSES = Object.freeze(['signing', 'encryption']);
export const KEY_HISTORY_LIMIT = 16;
/** Pruned kids per tombstone page (see the header). */
export const TOMBSTONE_PAGE = 128;
/** Most published-history entries a transfer-in imports beside the arriving key (spec §7: at most 64 document keys). */
export const IMPORTED_HISTORY_LIMIT = 63;
export const REVOCATION_REASONS = Object.freeze(['unspecified', 'compromise', 'owner', 'superseded']);
export const CONTINUITY_DOMAIN = '3sln-identity-key-continuity-v1';
const PREFIX = { signing: 'contact-key', encryption: 'identity-encryption-key' }, POINTER = { signing: 'signing-key', encryption: 'encryption-key' }, RETAINED = 'identity-key-retained', TOMBSTONE = 'identity-key-pruned', BINDING = 'identity-key-recovery';
export const RECOVERY_ISSUANCE_ROTATION = 'recovery-issuance';
export const TRANSFER_IN_ROTATION = 'transfer-in-activation';
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
/** Most kids an issuance keeps bound (merge, oldest trimmed first); half the history, so referenced keys still fit. */
export const RECOVERY_BINDING_LIMIT = 8;
export const IDENTITY_ALGORITHMS = Object.freeze(Object.assign(Object.create(null), { EdDSA: { name: 'Ed25519' }, ES256: { name: 'ECDSA', hash: 'SHA-256' } }));
export const importAlgorithm = alg => alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : IDENTITY_ALGORITHMS[alg];
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }, ECDH = { name: 'ECDH', namedCurve: 'P-256' };
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
const kidList = (value, max = 8) => Array.isArray(value) && value.length <= max && value.every(kid => boundedString(kid)) ? [...new Set(value)] : fail('invalid_key');
/** Signing kids `owner` still needs at `now` (ms): kids named by live stored records the provider re-serves, plus the
 * recovery binding. Records of other owners and expired, revoked or inactive records do not count (see header). */
export async function referencedSigningKids(tx, owner, now) {
  const kids = new Set(), live = exp => Number.isSafeInteger(exp) && exp * 1000 > now, add = kid => { if (boundedString(kid)) kids.add(kid); };
  for (const { value: grant } of await tx.list(key('contact-grant'))) if (grant?.owner === owner && grant.active === true && live(grant.claims?.exp)) { add(grant.header?.kid); add(grant.endpoint?.header?.kid); }
  for (const { value: link } of await tx.list(key('link'))) if (link?.owner === owner && link.revoked !== true && live(link.claims?.exp)) add(link.header?.kid);
  for (const kid of (await tx.get(key(BINDING, owner)))?.kids ?? []) add(kid);
  return kids;
}
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
/** Checks `next.continuity` against `signer` (a signing descriptor or record): for a signing rotation the signer is
 * the predecessor itself; for an encryption rotation it is the signing key current at rotation time. Pure. */
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
    // Encryption prunes only revoked public records (their private keys stay in `identity-key-retained/`), so a
    // revocation can always be followed by a replacement (review finding 1); retired encryption keys are never pruned.
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
  /** True when any of `kids` was pruned for `owner`: a legacy per-kid row, or a member of a tombstone page. */
  async #pruned(tx, owner, kids) {
    for (const kid of kids) if (await tx.get(key(TOMBSTONE, owner, kid))) return true;
    const wanted = new Set(kids);
    for (const { value } of await tx.list(tombstonePages(owner))) if (value?.owner === owner && Array.isArray(value.kids) && value.kids.some(kid => wanted.has(kid))) return true;
    return false;
  }
  /** Adds `kid` to the owner's tombstone set, folding any legacy per-kid rows into the pages first. */
  async #tombstone(tx, owner, kid) {
    const pages = (await tx.list(tombstonePages(owner))).filter(row => row.value?.owner === owner && Array.isArray(row.value.kids)).map(row => row.value).sort((a, b) => a.page - b.page);
    const members = new Set(pages.flatMap(page => page.kids)), fresh = [];
    for (const { key: path, value } of await tx.list(key(TOMBSTONE, owner))) if (typeof value?.kid === 'string' && !Array.isArray(value?.kids)) { if (!members.has(value.kid)) { members.add(value.kid); fresh.push(value.kid); } await tx.delete(path); }
    if (!members.has(kid)) fresh.push(kid);
    let page = pages.at(-1) ?? { owner, page: 0, kids: [] };
    for (const name of fresh) {
      if (page.kids.length >= TOMBSTONE_PAGE) { await tx.set(tombstonePage(owner, page.page), page); page = { owner, page: page.page + 1, kids: [] }; }
      page = { ...page, kids: [...page.kids, name] };
    }
    if (fresh.length) await tx.set(tombstonePage(owner, page.page), { ...page, at: this.clock() });
  }
  async #generate(purpose) {
    const pair = await this.crypto.subtle.generateKey(purpose === 'signing' ? ECDSA : ECDH, true, purpose === 'signing' ? ['sign', 'verify'] : ['deriveKey', 'deriveBits']);
    const publicJwk = publicOf(await this.crypto.subtle.exportKey('jwk', pair.publicKey));
    return { kid: this.crypto.randomUUID(), alg: purpose === 'signing' ? 'ES256' : 'ECDH-ES', publicJwk, encrypted: await this.seal(await this.crypto.subtle.exportKey('jwk', pair.privateKey)) };
  }
  async #importPrivate(purpose, jwk) { return this.crypto.subtle.importKey('jwk', jwk, purpose === 'signing' ? ECDSA : ECDH, false, purpose === 'signing' ? ['sign'] : ['deriveBits']); }

  /** Legacy public-only signing registration. Caller must have freshly authenticated the owner and confirmed key custody. */
  async register(owner, { kid, alg, publicJwk } = {}) {
    if (!boundedString(owner) || !boundedString(kid) || !IDENTITY_ALGORITHMS[alg] || !publicJwk || typeof publicJwk !== 'object' || Object.hasOwn(publicJwk, 'd')) fail('invalid_key');
    const clean = publicOf(publicJwk);
    try { await this.crypto.subtle.importKey('jwk', clean, importAlgorithm(alg), false, ['verify']); } catch { fail('invalid_key'); }
    return this.store.transaction(async tx => {
      const path = publicPath('signing', owner, kid);
      await fenced(tx);
      if (await tx.get(path) || await tx.get(publicPath('encryption', owner, kid)) || await this.#pruned(tx, owner, [kid])) fail('key_exists');
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
      if (record && keyState(record) === 'revoked') { if (purpose === 'encryption') await tx.set(key(RETAINED, owner, pointer.kid), { kid: pointer.kid, owner, purpose, encrypted: pointer.encrypted, retiredAt: record.revokedAt ?? this.clock() }); await tx.delete(POINTER[purpose]); pointer = undefined; }
      else if (pointer && pointer.owner === undefined) { pointer = { ...pointer, owner, purpose }; await tx.set(POINTER[purpose], pointer); }
      return [pointer, Boolean(record)];
    });
    if (existing) {
      if (published) return { kid: existing.kid, created: false };
      const publicJwk = publicOf(await this.open(existing.encrypted));
      return this.store.transaction(async tx => {
        const pointer = await this.#pointer(tx, owner, purpose); if (pointer?.kid !== existing.kid) fail('key_conflict');
        if (!await tx.get(publicPath(purpose, owner, existing.kid))) { await this.#admit(tx, owner, purpose, existing.kid); await tx.set(publicPath(purpose, owner, existing.kid), { owner, kid: existing.kid, alg: purpose === 'signing' ? 'ES256' : 'ECDH-ES', publicJwk, active: true, purpose, state: 'active', createdAt: this.clock(), seq: await this.#next(tx, owner, purpose) }); }
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
  // The recovery binding (see the header): only kids still present and not revoked are kept; an empty binding is removed.
  // Issuance MERGES (`merge`): existing ∪ kids, newest last, trimmed from the oldest end to RECOVERY_BINDING_LIMIT but never
  // dropping `kids`. A stale concurrent issuance (its identity CAS about to lose) therefore never unbinds the key the
  // committed credential depends on (review M2). Only a rotation outside issuance clears the binding; revocation removes.
  async #bind(tx, owner, kids, { merge = false } = {}) {
    if (merge) { const existing = (await tx.get(key(BINDING, owner)))?.kids ?? [], fresh = new Set(kids); const older = existing.filter(kid => !fresh.has(kid)); kids = [...older.slice(Math.max(0, older.length - Math.max(0, RECOVERY_BINDING_LIMIT - fresh.size))), ...fresh]; }
    const kept = [];
    for (const kid of new Set(kids)) { const record = boundedString(kid) && await tx.get(publicPath('signing', owner, kid)); if (record?.owner === owner && keyState(record) !== 'revoked') kept.push(kid); }
    if (kept.length) await tx.set(key(BINDING, owner), { owner, kids: kept, at: this.clock() }); else await tx.delete(key(BINDING, owner));
  }
  /** Replaces the current key of `purpose` (compare-and-set on `expectedKid`) and records signed continuity. A signing
   * rotation here clears the recovery binding: files issued before it no longer restore. */
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
  async #rotate(owner, { purpose, expectedKid, issuance, activation = false } = {}) {
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
      await this.#admit(tx, owner, purpose, expectedKid, issuance?.keep);
      const now = this.clock();
      await tx.set(publicPath(purpose, owner, expectedKid), { ...old, state: 'retired', retiredAt: now, successor: fresh.kid, ...activation ? { pinned: true } : {} });
      if (purpose === 'encryption') await tx.set(key(RETAINED, owner, expectedKid), { kid: expectedKid, owner, purpose, encrypted: pointer.encrypted, retiredAt: now });
      await tx.set(publicPath(purpose, owner, fresh.kid), { owner, kid: fresh.kid, alg: fresh.alg, publicJwk: fresh.publicJwk, active: true, purpose, state: 'active', createdAt: now, seq: await this.#next(tx, owner, purpose), predecessor: expectedKid, continuity: { alg: 'ES256', kid: signer, payload, signature }, ...issuance ? { rotation: RECOVERY_ISSUANCE_ROTATION } : activation ? { rotation: TRANSFER_IN_ROTATION } : {} });
      await tx.set(POINTER[purpose], { kid: fresh.kid, owner, purpose, encrypted: fresh.encrypted });
      if (purpose === 'signing') await this.#bind(tx, owner, issuance ? [...issuance.keep, expectedKid, fresh.kid] : [], { merge: Boolean(issuance) });
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
      if (pointer?.kid === kid) {
        if (purpose === 'encryption') await tx.set(key(RETAINED, owner, kid), { kid, owner, purpose, encrypted: pointer.encrypted, retiredAt: record.revokedAt });
        await tx.delete(POINTER[purpose]);
      }
      if (purpose === 'signing') { const binding = await tx.get(key(BINDING, owner)); if (binding?.kids?.includes(kid)) await this.#bind(tx, owner, binding.kids.filter(other => other !== kid)); }
      return describe(record, purpose, null);
    });
  }
  /** Rotation at recovery-file issuance (P15; see the header). Rotates the current signing key when it is one of
   * `rotateIf` or `always`, then binds `keep` plus the resulting current kid. Returns
   * {rotated, kid, previous, skipped}: `skipped` is 'key_history_full' when a full history of referenced keys refused it. */
  async rotateForRecovery(owner, { rotateIf = [], always = false, keep = [] } = {}) {
    ownerOf(owner); this.#sealing(); rotateIf = kidList(rotateIf); keep = kidList(keep); if (typeof always !== 'boolean') fail('invalid_key');
    const current = await this.store.transaction(async tx => { await fenced(tx); return this.#pointer(tx, owner, 'signing'); });
    if (!current) fail('identity_keys_unavailable');
    if (always || rotateIf.includes(current.kid)) {
      try { const rotated = await this.#rotate(owner, { purpose: 'signing', expectedKid: current.kid, issuance: { keep } }); return { rotated: true, kid: rotated.kid, previous: rotated.previous, skipped: null }; }
      catch (error) { if (error?.code !== 'key_history_full') throw error; }
      await this.store.transaction(tx => this.#bind(tx, owner, [...keep, current.kid], { merge: true }));
      return { rotated: false, kid: current.kid, previous: null, skipped: 'key_history_full' };
    }
    await this.store.transaction(async tx => { if ((await this.#pointer(tx, owner, 'signing'))?.kid !== current.kid) fail('key_conflict'); await this.#bind(tx, owner, [...keep, current.kid], { merge: true }); });
    return { rotated: false, kid: current.kid, previous: null, skipped: null };
  }
  /** Whether a file holding these kids would still restore (`recoveryMatch` without the private material): the current
   * encryption key, and the current signing key or a retired, unrevoked signing key bound to an issued file. The
   * active-account reissue checks it before committing a staged file (recovery-reissue.mjs). Never writes. */
  async recoveryKidsRestorable(owner, { signing, encryption } = {}) {
    ownerOf(owner); if (!boundedString(signing) || !boundedString(encryption)) return false;
    return this.store.transaction(async tx => {
      const pointer = await this.#pointer(tx, owner, 'signing'), enc = await this.#pointer(tx, owner, 'encryption'), record = await tx.get(publicPath('signing', owner, signing)), binding = await tx.get(key(BINDING, owner));
      if (enc?.kid !== encryption || record?.owner !== owner || keyState(record) === 'revoked') return false;
      return pointer?.kid === signing || keyState(record) === 'retired' && record.active === true && binding?.owner === owner && Array.isArray(binding.kids) && binding.kids.includes(signing);
    });
  }
  /** Whether a decrypted recovery keychain `{signing:{kid,privateJWK}, encryption:{kid,privateJWK}}` matches this
   * owner's keys: the current encryption key exactly, and either the current signing key exactly or a retired signing
   * key bound to an issued recovery file with the same public point (see the header). Never writes. */
  async recoveryMatch(owner, keychain) {
    ownerOf(owner); this.#sealing();
    const signing = keychain?.signing, encryption = keychain?.encryption, fields = ['kty', 'crv', 'x', 'y'];
    if (!boundedString(signing?.kid) || !boundedString(encryption?.kid) || !signing.privateJWK || !encryption.privateJWK) return false;
    const state = await this.store.transaction(async tx => ({ signing: await this.#pointer(tx, owner, 'signing'), encryption: await this.#pointer(tx, owner, 'encryption'), signingRecord: await tx.get(publicPath('signing', owner, signing.kid)), encryptionRecord: await tx.get(publicPath('encryption', owner, encryption.kid)), binding: await tx.get(key(BINDING, owner)) }));
    const same = (a, b, names) => names.every(name => typeof a?.[name] === 'string' && a[name] === b?.[name]);
    if (state.encryption?.kid !== encryption.kid || state.encryptionRecord?.owner !== owner || keyState(state.encryptionRecord) === 'revoked' || state.signingRecord?.owner !== owner || keyState(state.signingRecord) === 'revoked') return false;
    if (!same(await this.open(state.encryption.encrypted), encryption.privateJWK, [...fields, 'd'])) return false;
    if (state.signing?.kid === signing.kid) return same(await this.open(state.signing.encrypted), signing.privateJWK, [...fields, 'd']);
    return keyState(state.signingRecord) === 'retired' && state.signingRecord.active === true && state.binding?.owner === owner && state.binding.kids.includes(signing.kid) && same(publicOf(state.signingRecord.publicJwk), signing.privateJWK, fields);
  }
  /** PORT-4 intake: stores a portable package's private keys under this provider's custody, with the source's published
   * signing-key history (public only). Only while `transfer-in/v1` exists and is not active. `input`:
   * {signing:{kid, jwk, predecessor?, continuity?, created?}, encryption?:{kid, jwk}, history:[{kid, publicJwk, state,
   * created?, retired?, revoked?, predecessor?, continuity?}]}; times in Unix seconds as published. Idempotent for the
   * same keys; anything else already present is `key_conflict`. Never logs or returns key material. */
  async importTransfer(owner, input = {}) {
    ownerOf(owner); this.#sealing();
    const signing = input.signing, encryption = input.encryption ?? null, history = input.history ?? [];
    const point = jwk => ({ kty: 'EC', crv: 'P-256', x: jwk?.x, y: jwk?.y });
    const ok = (entry, d) => entry && boundedString(entry.kid) && typeof entry.jwk?.x === 'string' && typeof entry.jwk?.y === 'string' && (!d || typeof entry.jwk.d === 'string');
    if (!ok(signing, true) || (encryption && !ok(encryption, true)) || !Array.isArray(history) || history.length > IMPORTED_HISTORY_LIMIT) fail('invalid_key');
    for (const entry of history) if (!boundedString(entry?.kid) || typeof entry.publicJwk?.x !== 'string' || !['retired', 'revoked'].includes(entry.state) || entry.kid === signing.kid) fail('invalid_key');
    if (new Set([signing.kid, ...history.map(entry => entry.kid), ...encryption ? [encryption.kid] : []]).size !== history.length + 1 + (encryption ? 1 : 0)) fail('invalid_key');
    const ms = value => Number.isSafeInteger(value) && value >= 0 ? value * 1000 : undefined;
    const sealedSigning = await this.seal({ kty: 'EC', crv: 'P-256', x: signing.jwk.x, y: signing.jwk.y, d: signing.jwk.d }), sealedEncryption = encryption ? await this.seal({ kty: 'EC', crv: 'P-256', x: encryption.jwk.x, y: encryption.jwk.y, d: encryption.jwk.d }) : null;
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
      if (encryption) {
        const current = await this.#pointer(tx, owner, 'encryption'); if (current && current.kid !== encryption.kid) fail('key_conflict');
        if (!current) { await tx.set(publicPath('encryption', owner, encryption.kid), { owner, kid: encryption.kid, alg: 'ECDH-ES', publicJwk: point(encryption.jwk), active: true, purpose: 'encryption', state: 'active', createdAt: this.clock(), seq: await this.#next(tx, owner, 'encryption'), custody: 'imported' }); await tx.set(POINTER.encryption, { kid: encryption.kid, owner, purpose: 'encryption', encrypted: sealedEncryption }); }
      }
      return { kid: signing.kid, imported: true };
    });
  }
  /** PORT-4: custody ends for a transfer-in that will never activate (refused, cancelled, failed). Public records stay
   * for audit; pointers, retained private keys and the recovery binding are deleted. */
  async destroyCustody(owner) {
    ownerOf(owner);
    return this.store.transaction(async tx => {
      for (const purpose of KEY_PURPOSES) { const pointer = await this.#pointer(tx, owner, purpose); if (pointer) await tx.delete(POINTER[purpose]); }
      for (const { key: path } of await tx.list(key(RETAINED, owner))) await tx.delete(path);
      await tx.delete(key(BINDING, owner));
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
   * (own, pinned), encryption records and retained private keys, the recovery binding, and tombstones (kids, pages,
   * legacy rows not yet folded). Read-only. */
  async retainedState(owner) {
    ownerOf(owner);
    return this.store.transaction(async tx => {
      const signing = await this.#records(tx, owner, 'signing'), encryption = await this.#records(tx, owner, 'encryption');
      const pages = (await tx.list(tombstonePages(owner))).filter(row => row.value?.owner === owner && Array.isArray(row.value.kids));
      const legacy = (await tx.list(key(TOMBSTONE, owner))).filter(row => typeof row.value?.kid === 'string' && !Array.isArray(row.value?.kids));
      const binding = await tx.get(key(BINDING, owner));
      return { signing: { records: signing.length, pinned: signing.filter(record => record.pinned === true).length, own: signing.filter(record => record.pinned !== true).length, limit: this.historyLimit },
        encryption: { records: encryption.length, retained: (await tx.list(key(RETAINED, owner))).length },
        binding: Array.isArray(binding?.kids) ? binding.kids.length : 0,
        tombstones: { kids: pages.reduce((sum, row) => sum + row.value.kids.length, 0) + legacy.length, pages: pages.length, legacy: legacy.length, rows: pages.length + legacy.length } };
    });
  }
  /** Bounded history, oldest first. */
  async history(owner, { purpose } = {}) {
    purposeOf(purpose); ownerOf(owner);
    return this.store.transaction(async tx => { const pointer = await this.#pointer(tx, owner, purpose); return (await this.#records(tx, owner, purpose)).map(record => describe(record, purpose, pointer)); });
  }
  /** The current private key, imported non-extractable for its purpose only (sign, or ECDH deriveBits), or null. */
  async privateKey(owner, purpose, { transferStatement = false } = {}) {
    ownerOf(owner); purposeOf(purpose); this.#sealing();
    const pointer = await this.store.transaction(async tx => { await fenced(tx, { statement: transferStatement === true && purpose === 'signing' }); const found = await this.#pointer(tx, owner, purpose); return found && keyState(await tx.get(publicPath(purpose, owner, found.kid)) ?? { active: true }) !== 'revoked' ? found : null; });
    return pointer ? { kid: pointer.kid, privateKey: await this.#importPrivate(purpose, await this.open(pointer.encrypted)) } : null;
  }
  /** Internal identity-backup port only: the current private JWK of `purpose`, or null. Never expose through a route. */
  async exportPrivate(owner, purpose) {
    ownerOf(owner); purposeOf(purpose); this.#sealing();
    const pointer = await this.store.transaction(async tx => { await fenced(tx); return this.#pointer(tx, owner, purpose); });
    return pointer ? { kid: pointer.kid, privateJWK: await this.open(pointer.encrypted) } : null;
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
/** `input`: {rotateIf?, always?, keep?}; rotation at recovery-file issuance (P15). Purpose is always signing. */
export class RotateSigningKeyForRecovery extends KeyAction { run(keys) { return keys.rotateForRecovery(this.owner, this.input); } }
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
/** `input`: {keychain}; the recovery restore check (one-shot; nothing is retained). */
export class RecoveryKeychainMatches extends KeyQuery { fetch({ identityKeys }) { return identityKeys.recoveryMatch(this.owner, this.input.keychain); } }

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
