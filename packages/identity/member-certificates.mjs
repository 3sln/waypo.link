// ORG-4, member certificates: 3sln.me as a HOME provider (docs/spec/organizations.md §5.2, §5.2a, §14; design ORG-D5,
// ORG-D13, ORG-D14, §6.2, §13.3; reviews R2-M2, R2-M3, R2-M5, R4-H1). Provisional (coordinator), not signed off.
//
// The `key-delegation.v1` member-certificate profile (AMD-O12): a compact JWS whose protected header is exactly
// {alg:'ES256', kid, typ:'bindle-member-certificate+jwt'} and whose payload is exactly, in this order,
//   {bindle:'member-certificate', v:1, iss, sub, identity, aud, purposes, client:{client_id, origin}, cnf:{jkt},
//    delegate, aep, jti, iat, exp}
// signed with an `active` CERTIFICATION key of the identity (`use:"cert"`, provider-held, never in a recovery file
// or export; R4-H1), never with the identity signing key. The typ differs from Parlay's `bindle-key-delegation+jwt`
// and from intents' `bindle-intent+jwt`, so no profile accepts another's JWS.
//
// Engine-first: MemberCertificateIssuer is the provider resource in the PERSON's account single writer; the
// Actions/Queries at the end are its operations. Records (the person's account store):
//   member-cert/consent/<cid>   one per (aud, client): cid = b64url(SHA-256("member-consent\0" aud \0 client_id \0
//                               origin)). {aud, org, client, purposes, state, generation, aep, via, grantedAt, ...}.
//                               A consent is the "client grant the member approved" of §5.2; it is listed to the member
//                               with the holder keys it certified, and revoking it revokes them (R2-M2).
//   member-cert/key/<jkt>       a certified holder key, bound for good to one consent generation and one `aep`.
//   member-cert/pruned/<jkt>    permanent tombstones of pruned revoked keys (never certified again).
//   member-cert/meta            {epoch (issuance fence), newKeys (24 h window), auditSeq}
//   member-cert/audit/<seq>     a bounded audit ring.
// Certification keys keep the layout of packages/identity/transfer-in.mjs: `identity-cert-key/<owner>/<kid>/` and the
// sealed pointer `certification-key`. `ensureCertificationKey` mints the first one on demand (never while the identity
// is moving: keys.mjs custody fence) and the ORG-7 identity document lists it.
//
// Rules:
//   - Consent per (aud, client), created only by a trusted adapter from an authenticated home session, with `client`
//     the origin the adapter OBSERVED (embedder, Origin, or exact registered redirect URI; R2-M3), never a request
//     parameter. A consent remembers the `aep` it was granted under: after an authority reset (recovery, a move) every
//     earlier consent and key stops working until the member consents again, so a recovered account never inherits
//     consents it did not give.
//   - Issuance rests on a live consent and either the member's session (actor `owner`) or the client that holds the
//     consent (actor `app`, whose client the adapter observed). The holder proves possession (PoP below). A key that is,
//     or was, an identity signing key or a certification key of the account is refused. Several keys may be active per
//     consent (R2-M5: a second device never revokes the first), at most MEMBER_KEYS_PER_CONSENT; a further new key
//     supersedes the oldest of that consent.
//   - Lifetime: the issuer's choice, disclosed (spec §14 `max_certificate_seconds`). 3sln.me defaults to 660 s
//     (MEMBER_CERTIFICATE_DEFAULT_SECONDS), host-configurable down to 60 s; a same-host organization's own setting
//     (`orgLifetime(aud)`) and a shorter client request are honoured.
//   - `aep` comes from the identity record (packages/identity/authority-epoch.mjs). No readable epoch, no certificate.
//   - Status (`GET <identity URI>/delegations/<jkt>`, Parlay §3.4 semantics): {status:'active'} only for an active
//     key whose consent is active in the same generation and whose `aep` is current; a persisted revocation answers
//     {status:'revoked', revokedHour}; unknown keys and subjects answer exactly {status:'revoked'}. The first observed
//     mismatch (consent gone, epoch moved) is persisted, so nothing revives a key. Issuance commits re-check the fence.
//   - MEMBER_CERTIFICATES_ENABLED gates consent and issuance only; listing, revocation and status stay available.
//
// Proof of possession: `proof = {iat, signature}`, `signature` the base64url raw ES256 signature by the holder key over
// UTF-8 `bindle-member-certificate-pop-v1\n` followed by the JSON text
// `{"aud":<aud>,"client_id":<client_id>,"iat":<iat>,"iss":<issuer>,"jkt":<jkt>,"sub":<owner>}` (this member order),
// `iat` within 120 s. The prefix differs from every JWS signing input and from the Parlay PoP domain.
import { Provider } from '../../vendor/ngin/index.js';
import { AppAction, AppQuery } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { base64url, fromBase64url, textEncoder } from '../core/records.mjs';
import { strictIJSON as strictJSON } from '../core/strict-json.mjs';
import { custodyFence } from './keys.mjs';
import { delegatePublicJwk, jwkThumbprint, originValid, isJkt } from './delegation.mjs';

export const MEMBER_CERTIFICATE_TYP = 'bindle-member-certificate+jwt';
/** Placeholder identifiers under spec.bindle.example (the spec writes `…/purposes/member-access/v1`). */
export const MEMBER_PURPOSES = Object.freeze({ access: 'https://spec.bindle.example/purposes/member-access/v1', accept: 'https://spec.bindle.example/purposes/member-accept/v1' });
export const MEMBER_CERTIFICATE_MEMBERS = Object.freeze(['bindle', 'v', 'iss', 'sub', 'identity', 'aud', 'purposes', 'client', 'cnf', 'delegate', 'aep', 'jti', 'iat', 'exp']);
export const MEMBER_CERTIFICATE_DEFAULT_SECONDS = 660, MEMBER_CERTIFICATE_MIN_SECONDS = 60, MEMBER_CERTIFICATE_MAX_BYTES = 8192;
/** Disclosed bound within which a committed revocation reaches status answers (active answers cache for 60 s). */
export const MEMBER_REVOCATION_BOUND_SECONDS = 60, MEMBER_STATUS_CACHE_SECONDS = 60;
export const MEMBER_POP_DOMAIN = 'bindle-member-certificate-pop-v1\n', MEMBER_POP_SKEW_SECONDS = 120;
export const MEMBER_KEYS_PER_CONSENT = 8, MEMBER_CONSENT_LIMIT = 256, MEMBER_NEW_KEYS_PER_DAY = 64, MEMBER_KEY_HISTORY = 512, MEMBER_AUDIT_LIMIT = 256;
export const MEMBER_CERTIFICATES_FLAG = 'MEMBER_CERTIFICATES_ENABLED';
const KNOWN = Object.values(MEMBER_PURPOSES).sort();
const CONSENT = 'member-cert/consent/', KEY = 'member-cert/key/', PRUNED = 'member-cert/pruned/', META = 'member-cert/meta', AUDIT = 'member-cert/audit/';
const CERT_PREFIX = 'identity-cert-key', CERT_POINTER = 'certification-key', SIGNING_PREFIX = 'contact-key';
const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, JTI = /^[A-Za-z0-9_-]{16,128}$/, B64 = /^[A-Za-z0-9_-]+$/, KID = /^[\x21-\x7e]{1,128}$/;
const DAY = 86400000;

const fault = (code, message, status) => { throw new AppFault(code, message, status); };
const forbidden = () => fault('forbidden', 'This app cannot hold member certificates for this account.', 403);
const invalid = message => fault('invalid_request', message ?? 'Unsupported member certificate request.', 400);
const unavailable = () => fault('member_certificates_unavailable', 'Member certificates are unavailable right now.', 503);
const notFound = () => fault('not_found', 'Not found.', 404);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const only = (value, names) => plain(value) && Object.keys(value).every(name => names.includes(name));
const exactly = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const CLIENT_ID = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.isWellFormed() && !/[\p{Cc}\p{Bidi_Control}\u2028\u2029\u200b\ufeff]/u.test(value);
const hour = ms => Math.floor(ms / 3600000);
const pad = n => String(n).padStart(12, '0');

/** An absolute https URL (http only for loopback development), canonical, without userinfo, query or fragment. */
export function memberURL(value, loopback = false) {
  if (typeof value !== 'string' || value.length > 2048) return null; let u; try { u = new URL(value); } catch { return null; }
  const local = loopback === true && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (local && u.protocol === 'http:')) || u.username || u.password || u.hash || u.search || value.includes('#') || value.includes('?') || u.href !== value) return null;
  return u;
}
const purposesOf = value => Array.isArray(value) && value.length > 0 && value.length <= KNOWN.length && value.every((p, i) => KNOWN.includes(p) && (i === 0 || value[i - 1] < p)) ? value : null;
const clientOf = (value, loopback) => exactly(value, ['client_id', 'origin']) && CLIENT_ID(value.client_id) && originValid(value.origin, loopback) ? { client_id: value.client_id, origin: value.origin } : null;

// ---- the certificate profile (codec) --------------------------------------------------------------------------

function segment(value) {
  if (typeof value !== 'string' || !value || !B64.test(value)) throw new TypeError('segment');
  const bytes = fromBase64url(value); if (base64url(bytes) !== value) throw new TypeError('segment'); return bytes;
}
function json(value) { const parsed = strictJSON(new TextDecoder('utf-8', { fatal: true }).decode(segment(value))); if (!plain(parsed)) throw new TypeError('json'); return parsed; }
/** Strict syntax of a member certificate: exact header and payload members, types, bounds and received bytes. Throws
 * `invalid_certificate` on anything else. Returns {header, payload, input, signature}. No signature check here. */
export function parseMemberCertificate(compact, { allowLoopback = false } = {}) {
  try {
    if (typeof compact !== 'string' || compact.length > MEMBER_CERTIFICATE_MAX_BYTES) throw new TypeError('size');
    const parts = compact.split('.'); if (parts.length !== 3) throw new TypeError('parts');
    const header = json(parts[0]), payload = json(parts[1]), signature = segment(parts[2]);
    if (!exactly(header, ['alg', 'kid', 'typ']) || header.alg !== 'ES256' || header.typ !== MEMBER_CERTIFICATE_TYP || typeof header.kid !== 'string' || !KID.test(header.kid) || signature.length !== 64) throw new TypeError('header');
    if (!exactly(payload, MEMBER_CERTIFICATE_MEMBERS) || payload.bindle !== 'member-certificate' || payload.v !== 1) throw new TypeError('payload');
    const { iss, sub, identity, aud, purposes, client, cnf, delegate, aep, jti, iat, exp } = payload;
    if (!originValid(iss, allowLoopback) || typeof sub !== 'string' || !UUID.test(sub)) throw new TypeError('principal');
    const identityURL = memberURL(identity, allowLoopback); if (!identityURL || identityURL.origin !== iss) throw new TypeError('identity');
    if (!memberURL(aud, allowLoopback) || !purposesOf(purposes) || !clientOf(client, allowLoopback)) throw new TypeError('audience');
    if (!exactly(cnf, ['jkt']) || !isJkt(cnf.jkt) || !exactly(delegate, ['kty', 'crv', 'x', 'y'])) throw new TypeError('cnf');
    if (!nonNegative(aep) || typeof jti !== 'string' || !JTI.test(jti) || !nonNegative(iat) || !nonNegative(exp) || iat >= exp) throw new TypeError('times');
    return { header, payload, input: textEncoder.encode(`${parts[0]}.${parts[1]}`), signature };
  } catch { throw Object.assign(new Error('The member certificate is malformed.'), { code: 'invalid_certificate' }); }
}
/** The holder key the certificate binds: the delegate JWK, only when its RFC 7638 thumbprint equals `cnf.jkt`. */
export async function memberHolderKey(payload, crypto = globalThis.crypto) {
  const delegate = await delegatePublicJwk(payload?.delegate, crypto);
  return delegate && await jwkThumbprint(delegate.jwk, crypto) === payload.cnf?.jkt ? delegate : null;
}
/** ES256 signature of a parsed certificate under a P-256 public JWK. Never throws. */
export async function verifyMemberSignature(parsed, publicJwk, crypto = globalThis.crypto) {
  try { const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y }, P256, false, ['verify']); return await crypto.subtle.verify(ES256, key, parsed.signature, parsed.input); } catch { return false; }
}
/** Encodes claims in the profile's member order (missing or extra members are a programming error). */
export async function encodeMemberCertificate(claims, { kid, privateKey }, crypto = globalThis.crypto) {
  if (!exactly(claims, MEMBER_CERTIFICATE_MEMBERS)) throw new TypeError('Member certificate claims must have exactly the profile members.');
  const ordered = Object.fromEntries(MEMBER_CERTIFICATE_MEMBERS.map(name => [name, claims[name]]));
  const encode = value => base64url(textEncoder.encode(JSON.stringify(value)));
  const head = `${encode({ alg: 'ES256', kid, typ: MEMBER_CERTIFICATE_TYP })}.${encode(ordered)}`;
  return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign(ES256, privateKey, textEncoder.encode(head))))}`;
}
export const memberPopInput = ({ aud, clientId, iat, issuer, jkt, subject }) => textEncoder.encode(MEMBER_POP_DOMAIN + JSON.stringify({ aud, client_id: clientId, iat, iss: issuer, jkt, sub: subject }));
/** Client helper and test helper: the PoP an issuance request carries. */
export async function signMemberPop({ privateKey, aud, clientId, iat, issuer, jkt, subject }, crypto = globalThis.crypto) {
  return { iat, signature: base64url(new Uint8Array(await crypto.subtle.sign(ES256, privateKey, memberPopInput({ aud, clientId, iat, issuer, jkt, subject })))) };
}
export const consentId = async ({ aud, client }, crypto = globalThis.crypto) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(`member-consent\0${aud}\0${client.client_id}\0${client.origin}`))));
export const memberStatusPath = (subject, jkt) => `/identity/${subject}/delegations/${jkt}`;
/** Cache-Control for a status answer: a persisted revocation is final; anything else is bounded by 60 s. */
export const memberStatusCacheControl = result => result?.final ? 'public, max-age=86400, immutable' : `public, max-age=${MEMBER_STATUS_CACHE_SECONDS}`;
/** Host lifetime setting -> seconds within [60, 660]; unusable values yield null, which refuses issuance. */
export function memberCertificateLifetime(value) {
  if (value === undefined || value === null || value === '') return MEMBER_CERTIFICATE_DEFAULT_SECONDS;
  const seconds = typeof value === 'number' ? value : /^\d{1,9}$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < MEMBER_CERTIFICATE_MIN_SECONDS) return null;
  return Math.min(seconds, MEMBER_CERTIFICATE_DEFAULT_SECONDS);
}

// ---- certification keys (spec §3a.3 `use:"cert"`; layout of transfer-in.mjs) ---------------------------------

/** Signer port over an account store (`metadata`: transaction(tx => get/put/list({prefix}))): the owner's current
 * active certification key, minting one on first use. Concurrent first uses keep exactly one key (checked in the
 * commit). Nothing is minted while the identity moves (custody fence). Returns `owner -> {kid, privateKey}`. */
export function certificationSigner({ metadata, seal, open, clock = () => Date.now(), crypto = globalThis.crypto }) {
  if (typeof metadata?.transaction !== 'function' || typeof seal !== 'function' || typeof open !== 'function') throw new TypeError('Certification keys need an account store and sealing.');
  const current = tx => tx.get(CERT_POINTER).then(async pointer => { if (!pointer?.kid || typeof pointer.owner !== 'string') return null; const record = await tx.get(`${CERT_PREFIX}/${encodeURIComponent(pointer.owner)}/${encodeURIComponent(pointer.kid)}/`); return record?.state === 'active' ? pointer : null; });
  return async owner => {
    let pointer = await metadata.transaction(async tx => { if (await custodyFence(tx)) fault('identity_moved', 'This identity moved to another provider.', 409); const found = await current(tx); if (found && found.owner !== owner) forbidden(); return found; });
    if (!pointer) {
      const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']), { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey), sealed = await seal(await crypto.subtle.exportKey('jwk', pair.privateKey)), kid = crypto.randomUUID();
      pointer = await metadata.transaction(async tx => {
        if (await custodyFence(tx)) fault('identity_moved', 'This identity moved to another provider.', 409);
        const found = await current(tx); if (found) { if (found.owner !== owner) forbidden(); return found; }
        const now = clock();
        for (const [path, value] of await tx.list({ prefix: `${CERT_PREFIX}/${encodeURIComponent(owner)}/` })) if (value?.state === 'active') await tx.put(path, { ...value, state: 'retired', retiredAt: now });
        await tx.put(`${CERT_PREFIX}/${encodeURIComponent(owner)}/${encodeURIComponent(kid)}/`, { owner, kid, alg: 'ES256', publicJwk: { kty: 'EC', crv: 'P-256', x, y }, state: 'active', createdAt: now });
        const next = { owner, kid, encrypted: sealed }; await tx.put(CERT_POINTER, next); return next;
      });
    }
    const jwk = await open(pointer.encrypted);
    return { kid: pointer.kid, privateKey: await crypto.subtle.importKey('jwk', jwk, P256, false, ['sign']) };
  };
}
/** Public certification-key descriptors of `owner` in an account store (same records as transfer-in's). */
export async function certificationKeyList(metadata, owner) {
  return metadata.transaction(async tx => [...(await tx.list({ prefix: `${CERT_PREFIX}/${encodeURIComponent(owner)}/` })).values()].filter(row => row?.owner === owner).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).map(row => ({ kid: row.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: row.publicJwk.x, y: row.publicJwk.y }, state: row.state })));
}

// ---- the home issuer --------------------------------------------------------------------------------------------

const consentView = (consent, keys) => ({ id: consent.cid, aud: consent.aud, org: consent.org ?? null, client: { ...consent.client }, purposes: [...consent.purposes], state: consent.state, via: consent.via, grantedAt: consent.grantedAt, revokedAt: consent.revokedAt ?? null, reason: consent.reason ?? null,
  keys: keys.filter(key => key.cid === consent.cid).map(key => ({ jkt: key.jkt, state: key.state, purposes: [...key.purposes], createdAt: key.createdAt, issued: key.issued, lastIssuedAt: key.last ? key.last.iat * 1000 : null, lastExpiresAt: key.last ? key.last.exp * 1000 : null, revokedAt: key.revokedAt ?? null, reason: key.reason ?? null })) });

export class MemberCertificateIssuer {
  /** `metadata`: the person's account store. `issuer`: this provider's origin. `account(owner)` -> {status} | null.
   * `authorityEpoch(owner)` -> non-negative integer | null (packages/identity/authority-epoch.mjs). `identityURI(owner)`
   * -> the published identity URI. `signer(owner)` -> {kid, privateKey} (certificationSigner). `orgLifetime(aud)` ->
   * seconds | null: a same-host organization's own setting. `enabled(owner, clientId?)` -> MEMBER_CERTIFICATES_ENABLED.
   * `lifetime`: host seconds (memberCertificateLifetime). */
  constructor({ metadata, issuer, account, authorityEpoch, identityURI, signer, orgLifetime, enabled, lifetime, clock = () => Date.now(), crypto = globalThis.crypto, uuid, allowLoopback = false, keysPerConsent = MEMBER_KEYS_PER_CONSENT, newKeysPerDay = MEMBER_NEW_KEYS_PER_DAY, historyLimit = MEMBER_KEY_HISTORY, auditLimit = MEMBER_AUDIT_LIMIT }) {
    if (typeof metadata?.transaction !== 'function') throw new TypeError('Invalid member certificate issuer');
    Object.assign(this, { metadata, issuer, account, authorityEpoch, identityURI, signer, orgLifetime, enabled, clock, crypto, uuid: uuid ?? (() => crypto.randomUUID()), lifetime: memberCertificateLifetime(lifetime), allowLoopback: allowLoopback === true, keysPerConsent, newKeysPerDay, historyLimit, auditLimit });
  }
  #on(owner, clientId) { try { return typeof this.enabled === 'function' ? this.enabled(owner, clientId) === true : this.enabled === true; } catch { return false; } }
  async #active(owner) { try { return (await this.account?.(owner))?.status === 'active'; } catch { return false; } }
  async #aep(owner) { let value; try { value = await this.authorityEpoch?.(owner); } catch { unavailable(); } if (!nonNegative(value)) unavailable(); return value; }
  async #meta(tx) { return await tx.get(META) ?? { epoch: 0, newKeys: [], auditSeq: 0 }; }
  async #consents(tx) { return [...(await tx.list({ prefix: CONSENT })).values()].filter(plain).sort((a, b) => a.grantedAt - b.grantedAt || a.cid.localeCompare(b.cid)); }
  async #keys(tx) { return [...(await tx.list({ prefix: KEY })).values()].filter(plain).sort((a, b) => a.seq - b.seq); }
  async #audit(tx, meta, entry) { meta.auditSeq += 1; await tx.put(AUDIT + pad(meta.auditSeq), { at: this.clock(), ...entry }); if (meta.auditSeq > this.auditLimit) await tx.delete(AUDIT + pad(meta.auditSeq - this.auditLimit)); }
  async #revokeKey(tx, meta, record, reason, actor) { if (record.state === 'revoked') return false; await tx.put(KEY + record.jkt, { ...record, state: 'revoked', revokedAt: this.clock(), reason }); await this.#audit(tx, meta, { event: 'key-revoked', jkt: record.jkt, consent: record.cid, reason, actor }); return true; }
  async #revokeConsent(tx, meta, consent, reason, actor) {
    let keys = 0; for (const record of await this.#keys(tx)) if (record.cid === consent.cid && await this.#revokeKey(tx, meta, record, reason, actor)) keys++;
    if (consent.state !== 'revoked') { await tx.put(CONSENT + consent.cid, { ...consent, state: 'revoked', revokedAt: this.clock(), reason }); await this.#audit(tx, meta, { event: 'consent-revoked', consent: consent.cid, aud: consent.aud, clientId: consent.client.client_id, reason, actor }); }
    return keys;
  }
  async #prune(tx) {
    const records = await this.#keys(tx);
    for (const victim of records.filter(record => record.state === 'revoked').slice(0, Math.max(0, records.length - this.historyLimit))) { await tx.put(PRUNED + victim.jkt, { jkt: victim.jkt, revokedAt: victim.revokedAt }); await tx.delete(KEY + victim.jkt); }
  }
  // Thumbprints of every signing and certification key the account has held, so no holder key aliases one.
  async #aliases(tx, owner) {
    const out = new Set();
    for (const prefix of [`${SIGNING_PREFIX}/${encodeURIComponent(owner)}/`, `${CERT_PREFIX}/${encodeURIComponent(owner)}/`]) for (const value of (await tx.list({ prefix })).values()) { const jwk = value?.publicJwk; if (value?.owner === owner && jwk?.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string') out.add(await jwkThumbprint(jwk, this.crypto)); }
    return out;
  }

  /** Records the member's consent for (aud, client). `actor`: {kind:'owner', owner, client:{client_id, origin}} with
   * the client the adapter observed. `input`: {aud, purposes, org?:{handle}}. Idempotent; a narrower purpose set
   * revokes keys that hold a dropped purpose. */
  async consent(owner, actor, input) {
    if (actor?.kind !== 'owner' || actor.owner !== owner) forbidden();
    const client = clientOf(actor.client, this.allowLoopback); if (!client) invalid('The client origin could not be verified.');
    if (!only(input, ['aud', 'purposes', 'org']) || !memberURL(input.aud, this.allowLoopback)) invalid('Choose an organization by its identity URI.');
    const purposes = purposesOf(input.purposes); if (!purposes) invalid('Choose recognized purposes in ascending order.');
    const org = input.org === undefined ? null : only(input.org, ['handle']) && (input.org.handle === undefined || (typeof input.org.handle === 'string' && input.org.handle.length <= 320)) ? { ...input.org } : invalid();
    if (!this.#on(owner, client.client_id)) notFound();
    if (!await this.#active(owner)) forbidden();
    const aep = await this.#aep(owner), cid = await consentId({ aud: input.aud, client }, this.crypto);
    return this.metadata.transaction(async tx => {
      const meta = await this.#meta(tx), granted = await this.#grant(tx, meta, { cid, owner, aud: input.aud, org, client, purposes, aep });
      if (granted.changed) await tx.put(META, meta);
      return consentView(granted.consent, await this.#keys(tx));
    });
  }
  // The consent a grant would leave behind, without writing (the acquire plan): same generation when an active consent
  // of the current epoch exists, the next generation otherwise.
  static #expected(prior, aep) { return prior?.state === 'active' && prior.aep === aep ? prior.generation : (prior?.generation ?? 0) + 1; }
  // Writes the member's consent for (aud, client) inside `tx`. Idempotent; narrowing revokes keys holding a dropped
  // purpose; an active consent of an earlier authority epoch is revoked and replaced by the next generation.
  async #grant(tx, meta, { cid, owner, aud, org, client, purposes, aep }) {
    const prior = await tx.get(CONSENT + cid), now = this.clock();
    if (prior?.state === 'active' && prior.aep === aep) {
      if (prior.purposes.length === purposes.length && prior.purposes.every((p, i) => p === purposes[i])) return { consent: prior, changed: false };
      for (const record of await this.#keys(tx)) if (record.cid === cid && record.state === 'active' && !record.purposes.every(p => purposes.includes(p))) await this.#revokeKey(tx, meta, record, 'consent-narrowed', 'owner');
      const next = { ...prior, purposes, org: org ?? prior.org ?? null, updatedAt: now }; await tx.put(CONSENT + cid, next); await this.#audit(tx, meta, { event: 'consent-changed', consent: cid, purposes });
      return { consent: next, changed: true };
    }
    if (prior?.state === 'active') await this.#revokeConsent(tx, meta, prior, 'authority-reset', 'system');
    if (!prior && (await this.#consents(tx)).filter(row => row.state === 'active').length >= MEMBER_CONSENT_LIMIT) fault('rate_limited', 'Too many organization and app consents.', 429);
    const next = { cid, owner, aud, org, client, purposes, state: 'active', generation: (prior?.generation ?? 0) + 1, aep, via: 'session', grantedAt: now };
    await tx.put(CONSENT + cid, next); await this.#audit(tx, meta, { event: 'consent-granted', consent: cid, aud, clientId: client.client_id, origin: client.origin, purposes });
    return { consent: next, changed: true };
  }

  /** ORG-6a: the member's consent and the first certificate in ONE committing transaction (review M1), so a stale or
   * refused proof never leaves an active consent behind. `actor`: {kind:'owner', owner, client} with the client the
   * adapter observed. `input`: {aud, purposes, delegate, proof:{iat, signature}}. Returns issue()'s result. */
  async acquire(owner, actor, input) {
    if (actor?.kind !== 'owner' || actor.owner !== owner) forbidden();
    const client = clientOf(actor.client, this.allowLoopback); if (!client) invalid('The client origin could not be verified.');
    if (!only(input, ['aud', 'purposes', 'delegate', 'proof'])) invalid();
    return this.#issue(owner, { kind: 'owner', owner }, { ...input, client }, true);
  }

  /** Issues one certificate. `actor`: {kind:'owner', owner} (the member's session; `input.client` names the consent's
   * client) or {kind:'app', owner, client:{client_id, origin}} (the client the adapter observed). `input`: {aud,
   * purposes, delegate, proof:{iat, signature}, lifetime?, client? (owner only)}. Returns {certificate, jkt, jti, iat,
   * exp, aep, status}. */
  async issue(owner, actor, input) { return this.#issue(owner, actor, input, false); }
  async #issue(owner, actor, input, grant) {
    if (!['owner', 'app'].includes(actor?.kind) || actor.owner !== owner) forbidden();
    if (!only(input, ['aud', 'purposes', 'delegate', 'proof', 'lifetime', ...actor.kind === 'owner' ? ['client'] : []]) || !only(input.proof, ['iat', 'signature'])) invalid();
    const client = clientOf(actor.kind === 'app' ? actor.client : input.client, this.allowLoopback); if (!client) actor.kind === 'app' ? forbidden() : invalid('Name the app this certificate is for.');
    if (!this.#on(owner, client.client_id)) notFound();
    if (this.lifetime === null || typeof this.signer !== 'function' || !originValid(this.issuer, this.allowLoopback)) unavailable();
    if (!memberURL(input.aud, this.allowLoopback)) invalid('Choose an organization by its identity URI.');
    const purposes = purposesOf(input.purposes); if (!purposes) invalid('Choose recognized purposes in ascending order.');
    if (!await this.#active(owner)) forbidden();
    const aep = await this.#aep(owner), cid = await consentId({ aud: input.aud, client }, this.crypto);
    const requested = input.lifetime === undefined ? null : Number.isSafeInteger(input.lifetime) && input.lifetime >= MEMBER_CERTIFICATE_MIN_SECONDS ? input.lifetime : invalid('Choose a certificate lifetime of at least 60 seconds.');
    let orgSeconds = null; try { orgSeconds = memberCertificateLifetime(await this.orgLifetime?.(input.aud) ?? undefined); } catch { orgSeconds = null; }
    const lifetime = Math.min(this.lifetime, orgSeconds ?? this.lifetime, requested ?? Infinity);
    const delegate = await delegatePublicJwk(input.delegate, this.crypto); if (!delegate) invalid('Send a P-256 public key only.');
    const jkt = await jwkThumbprint(delegate.jwk, this.crypto), nowMs = this.clock(), now = Math.floor(nowMs / 1000), { iat: popIat, signature } = input.proof;
    if (!Number.isSafeInteger(popIat) || Math.abs(popIat - now) > MEMBER_POP_SKEW_SECONDS || typeof signature !== 'string' || signature.length !== 86 || !B64.test(signature)) invalid('The proof of possession is missing or stale.');
    let sigBytes; try { sigBytes = fromBase64url(signature); } catch { sigBytes = null; }
    if (sigBytes?.length !== 64 || !await this.crypto.subtle.verify(ES256, delegate.key, sigBytes, memberPopInput({ aud: input.aud, clientId: client.client_id, iat: popIat, issuer: this.issuer, jkt, subject: owner }))) invalid('The proof of possession is missing or stale.');
    const identity = await this.identityURI?.(owner); if (!memberURL(identity, this.allowLoopback) || new URL(identity).origin !== this.issuer) unavailable();

    const plan = await this.metadata.transaction(async tx => {
      const prior = await tx.get(CONSENT + cid), record = await tx.get(KEY + jkt), meta = await this.#meta(tx);
      // A grant plans against the consent it would write; nothing is written until the final commit.
      const consent = grant ? { state: 'active', aep, purposes, generation: MemberCertificateIssuer.#expected(prior, aep) } : prior;
      if (grant && !prior && (await this.#consents(tx)).filter(row => row.state === 'active').length >= MEMBER_CONSENT_LIMIT) return { refuse: 'consents' };
      if (!consent || consent.state !== 'active' || consent.aep !== aep || !purposes.every(p => consent.purposes.includes(p))) return { refuse: 'consent' };
      if ((await this.#aliases(tx, owner)).has(jkt)) return { refuse: 'alias' };
      if (await tx.get(PRUNED + jkt) || record?.state === 'revoked') return { refuse: 'revoked' };
      if (record && (record.cid !== cid || record.generation !== consent.generation || record.aep !== aep)) return { refuse: 'moved' };
      if (!record && meta.newKeys.filter(at => at > nowMs - DAY).length >= this.newKeysPerDay) return { refuse: 'rate' };
      return { generation: consent.generation, epoch: meta.epoch, fresh: !record };
    });
    if (plan.refuse === 'consents') fault('rate_limited', 'Too many organization and app consents.', 429);
    if (plan.refuse === 'consent') fault('consent_required', 'Approve this app for this organization first.', 403);
    if (plan.refuse === 'alias') invalid('An identity key cannot be a holder key.');
    if (plan.refuse === 'revoked') fault('delegation_revoked', 'This holder key was revoked. Generate a new key.', 409);
    if (plan.refuse === 'rate') fault('rate_limited', 'Too many new holder keys today.', 429);
    if (plan.refuse === 'moved') {
      // A key never moves between consents, consent generations or authority epochs: revoke it where it was, then refuse.
      await this.metadata.transaction(async tx => { const meta = await this.#meta(tx), record = await tx.get(KEY + jkt); if (record && await this.#revokeKey(tx, meta, record, 'rebound', 'system')) await tx.put(META, meta); });
      fault('delegation_revoked', 'This holder key belongs to another consent. Generate a new key.', 409);
    }
    const signer = await this.signer(owner); if (!signer?.kid || !signer.privateKey) unavailable();
    const jti = base64url(this.crypto.getRandomValues(new Uint8Array(24)));
    const claims = { bindle: 'member-certificate', v: 1, iss: this.issuer, sub: owner, identity, aud: input.aud, purposes, client, cnf: { jkt }, delegate: delegate.jwk, aep, jti, iat: now, exp: now + lifetime };
    const certificate = await encodeMemberCertificate(claims, signer, this.crypto);
    // Everything may have moved while signing: the account, the epoch, the consent, a revocation fence.
    if (!await this.#active(owner) || await this.#aep(owner) !== aep) forbidden();
    return this.metadata.transaction(async tx => {
      const meta = await this.#meta(tx);
      // A grant commits only onto the consent generation it planned against (a concurrent identical grant is fine).
      if (grant && MemberCertificateIssuer.#expected(await tx.get(CONSENT + cid), aep) !== plan.generation) fault('delegation_conflict', 'The consent changed meanwhile. Try again.', 409);
      const consent = grant ? (await this.#grant(tx, meta, { cid, owner, aud: input.aud, org: null, client, purposes, aep })).consent : await tx.get(CONSENT + cid), record = await tx.get(KEY + jkt);
      if (!consent || consent.state !== 'active' || consent.generation !== plan.generation || consent.aep !== aep || meta.epoch !== plan.epoch || await tx.get(PRUNED + jkt) || record?.state === 'revoked' || (record ? record.cid !== cid : !plan.fresh)) fault('delegation_conflict', 'The consent changed meanwhile. Try again.', 409);
      const fresh = !record;
      if (fresh) meta.newKeys = [...meta.newKeys.filter(at => at > nowMs - DAY), nowMs].slice(-this.newKeysPerDay);
      if (fresh) meta.seq = (meta.seq ?? 0) + 1;
      const next = { owner, jkt, delegate: delegate.jwk, cid, generation: consent.generation, aud: consent.aud, client, purposes: [...new Set([...(record?.purposes ?? []), ...purposes])].sort(), aep, state: 'active', createdAt: record?.createdAt ?? nowMs, seq: record?.seq ?? meta.seq, issued: (record?.issued ?? 0) + 1, last: { jti, iat: claims.iat, exp: claims.exp, kid: signer.kid } };
      await tx.put(KEY + jkt, next);
      await this.#audit(tx, meta, { event: fresh ? 'key-certified' : 'key-renewed', jkt, consent: cid, clientId: client.client_id, jti, exp: claims.exp * 1000, actor: actor.kind });
      // Several keys per consent (R2-M5), bounded: the oldest active ones are superseded beyond the limit.
      if (fresh) { const active = (await this.#keys(tx)).filter(row => row.cid === cid && row.state === 'active' && row.jkt !== jkt); for (const old of active.slice(0, Math.max(0, active.length + 1 - this.keysPerConsent))) await this.#revokeKey(tx, meta, old, 'superseded', 'system'); }
      await this.#prune(tx); await tx.put(META, meta);
      return { certificate, jkt, jti, iat: claims.iat, exp: claims.exp, aep, purposes, status: `${this.issuer}${memberStatusPath(owner, jkt)}` };
    });
  }

  /** `input`: {consent} (its id) | {aud, clientId} | {all:true}, plus `reason`. Owner or system. Idempotent. Bumps the
   * issuance fence so a certificate being signed meanwhile cannot commit. */
  async revokeConsent(owner, actor, input) {
    if (!['owner', 'system'].includes(actor?.kind) || actor.owner !== owner) forbidden();
    if (!only(input, ['consent', 'aud', 'clientId', 'all', 'reason'])) invalid();
    const selectors = [input.consent !== undefined, input.aud !== undefined || input.clientId !== undefined, input.all === true].filter(Boolean).length;
    if (selectors !== 1 || (input.consent !== undefined && (typeof input.consent !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.consent))) || (input.aud !== undefined && typeof input.aud !== 'string') || (input.clientId !== undefined && !CLIENT_ID(input.clientId))) invalid();
    const reason = input.reason ?? actor.kind, allowed = { owner: ['owner', 'compromise'], system: ['system', 'suspended', 'deleted', 'recovered', 'compromise', 'client-breach', 'uninstalled'] }[actor.kind];
    if (!allowed.includes(reason)) invalid();
    return this.metadata.transaction(async tx => {
      const meta = await this.#meta(tx); let consents = 0, keys = 0;
      for (const consent of await this.#consents(tx)) {
        const match = input.all === true ? true : input.consent !== undefined ? input.consent === consent.cid : (input.aud === undefined || input.aud === consent.aud) && (input.clientId === undefined || input.clientId === consent.client.client_id);
        if (!match) continue; const was = consent.state; keys += await this.#revokeConsent(tx, meta, consent, reason, actor.kind); if (was !== 'revoked') consents++;
      }
      meta.epoch += 1; await tx.put(META, meta);
      return { consents, keys };
    });
  }
  /** `input`: {jkt, reason?}. Owner, system, or the app for its own keys (an app sees only its keys: others are 404). */
  async revokeKey(owner, actor, input) {
    if (!['owner', 'app', 'system'].includes(actor?.kind) || actor.owner !== owner) forbidden();
    if (!only(input, ['jkt', 'reason']) || !isJkt(input.jkt)) invalid();
    const reason = input.reason ?? actor.kind, allowed = { owner: ['owner', 'compromise'], app: ['app'], system: ['system', 'compromise'] }[actor.kind];
    if (!allowed.includes(reason)) invalid();
    return this.metadata.transaction(async tx => {
      const record = await tx.get(KEY + input.jkt);
      if (!record || (actor.kind === 'app' && (record.client.client_id !== actor.client?.client_id || record.client.origin !== actor.client?.origin))) notFound();
      const meta = await this.#meta(tx), revoked = await this.#revokeKey(tx, meta, record, reason, actor.kind);
      if (revoked) await tx.put(META, meta);
      return { revoked: revoked ? 1 : 0 };
    });
  }
  /** Owner view: every consent with the keys it certified, and the newest audit rows. No certificate bytes. */
  async list(owner, actor) {
    if (actor?.kind !== 'owner' || actor.owner !== owner) forbidden();
    return this.metadata.transaction(async tx => { const keys = await this.#keys(tx); return { consents: (await this.#consents(tx)).map(consent => consentView(consent, keys)), audit: [...(await tx.list({ prefix: AUDIT })).values()].slice(-50).reverse() }; });
  }
  /** Public status of one jkt (see the header). `final` marks a persisted revocation. Throws 503 when the epoch cannot
   * be read for an otherwise active key (never answers `active` blind). */
  async status(owner, jkt) {
    if (!isJkt(jkt)) return { status: 'revoked', final: false };
    const read = await this.metadata.transaction(async tx => { const record = await tx.get(KEY + jkt); return record?.owner === owner ? { record, consent: await tx.get(CONSENT + record.cid) } : null; });
    if (!read) return { status: 'revoked', final: false };
    if (read.record.state === 'revoked') return { status: 'revoked', revokedHour: hour(read.record.revokedAt), final: true };
    const active = await this.#active(owner), aep = active ? await this.#aep(owner) : null;
    if (active && read.consent?.state === 'active' && read.consent.generation === read.record.generation && read.consent.aep === aep && read.record.aep === aep) return { status: 'active', final: false };
    if (!active) return { status: 'revoked', final: false };
    // The first observed mismatch is persisted (one write per key), so a returning consent never revives the key.
    const persisted = await this.metadata.transaction(async tx => {
      const now = await tx.get(KEY + jkt); if (now?.state !== 'active' || now.last?.jti !== read.record.last?.jti) return now;
      const meta = await this.#meta(tx); await this.#revokeKey(tx, meta, now, read.consent?.state === 'active' ? 'authority-reset' : 'consent-revoked', 'system'); await tx.put(META, meta); return tx.get(KEY + jkt);
    });
    return persisted?.state === 'revoked' ? { status: 'revoked', revokedHour: hour(persisted.revokedAt), final: true } : { status: 'revoked', final: false };
  }
}

// ---- engine operations ------------------------------------------------------------------------------------------
// Actors are built by trusted adapters only (packages/runtime/account/member-certificates.mjs), never from a body:
//   {kind:'owner', owner, client?}        consent and acquire (client = the observed client), issue (session), list, revoke
//   {kind:'app', owner, client}           issue and revoke its own keys; `client` is the observed client
//   {kind:'system', owner}                revoke (suspension, recovery, deletion, client breach)
//   {kind:'public', owner}                status only
/** The `memberCertificates` provider class over one issuer (one per person account single writer). */
export function memberCertificatesProvider(issuer) { return class extends Provider { static deps = []; obtain() { return issuer; } release() {} }; }
class MemberAction extends AppAction { static deps = ['memberCertificates']; static changes = 'member-certificates-changed'; }
class MemberQuery extends AppQuery { static deps = ['memberCertificates']; static refreshOn = ['member-certificates-changed']; }
const ownerOfActor = actor => typeof actor?.owner === 'string' && UUID.test(actor.owner) ? actor.owner : fault('unauthorized', 'Sign in to continue.', 401);
export class GrantMemberConsent extends MemberAction { static operation = 'member-certificates.consent'; run({ memberCertificates }) { return memberCertificates.consent(ownerOfActor(this.actor), this.actor, this.input); } }
/** ORG-6a: consent and first issuance as one committing transaction (actor {kind:'owner', owner, client}). */
export class AcquireMemberConsentCertificate extends MemberAction { static operation = 'member-certificates.acquire'; run({ memberCertificates }) { return memberCertificates.acquire(ownerOfActor(this.actor), this.actor, this.input); } }
export class IssueMemberCertificate extends MemberAction { static operation = 'member-certificates.issue'; run({ memberCertificates }) { return memberCertificates.issue(ownerOfActor(this.actor), this.actor, this.input); } }
export class RevokeMemberConsent extends MemberAction { static operation = 'member-certificates.revoke-consent'; static lifecycle = 'suspended'; run({ memberCertificates }) { return memberCertificates.revokeConsent(ownerOfActor(this.actor), this.actor, this.input); } }
export class RevokeMemberKey extends MemberAction { static operation = 'member-certificates.revoke-key'; static lifecycle = 'suspended'; run({ memberCertificates }) { return memberCertificates.revokeKey(ownerOfActor(this.actor), this.actor, this.input); } }
export class MemberCertificateList extends MemberQuery { static operation = 'member-certificates.list'; static lifecycle = 'suspended'; fetch({ memberCertificates }) { return memberCertificates.list(ownerOfActor(this.actor), this.actor); } }
/** Public; runs outside the account gate. `input`: {jkt}. */
export class MemberCertificateStatus extends MemberQuery { static operation = 'member-certificates.status'; static lifecycle = 'purging'; static gate = 'none'; fetch({ memberCertificates }) { return only(this.input, ['jkt']) ? memberCertificates.status(ownerOfActor(this.actor), this.input.jkt) : invalid(); } }
export const MEMBER_CERTIFICATE_OPERATIONS = Object.freeze([GrantMemberConsent, AcquireMemberConsentCertificate, IssueMemberCertificate, RevokeMemberConsent, RevokeMemberKey, MemberCertificateList, MemberCertificateStatus]);
