// ORG-4, member certificates at the ORGANIZATION's provider: verification, the member-context token form, the
// BindleMember direct form and `bindle_member` (docs/spec/organizations.md §5.2, §5.2a, §7.1–§7.3; design ORG-D5,
// ORG-D7, ORG-D14, §6.2; reviews R2-H1, R2-H2, R2-M1, R2-L2, R4-H1, R4-M3). Provisional (coordinator), not signed off.
//
// Engine-first: MemberContextService is the provider resource in the ORGANIZATION's account single writer; the
// Actions/Queries at the end are its operations. HTTP adapters (packages/runtime/routes/member-certificates.mjs) only
// parse and serialize.
//
// Verification order (spec §5.2), every step evaluated, every failure the SAME result (R2-H1):
//   1. syntax, typ, bindle, v, aud = this organization's identity URI, purpose, client_id (token form), expiry with
//      60 s skew, the effective-lifetime cap (iat + this organization's certificate lifetime, R4-M3), then the
//      membership for the certificate's origin principal (successor index), with no network fetch;
//   2. the signature under an ACTIVE CERTIFICATION key of the identity (R4-H1), resolved CACHE-ONLY for the claimed
//      (iss, sub, kid), and the certificate's `identity` equal to the directory-derived or pinned identity URI (R2-H2);
//      when step 1 failed or the key is not cached, an equivalent verification runs against a fixed dummy key. For
//      ANY syntactically valid claimed principal of a local or allowed foreign issuer whose cached keys are missing or
//      stale, member or not, the request path enqueues a 'claimed' refresh through a bounded queue (F-07; the write
//      depends on the cache, never on membership, keeping review LM1's uniform cost);
//   3. the DPoP proof by the certified key: thumbprint = cnf.jkt = thumbprint(delegate), htm, htu, iat within 60 s,
//      `ath` (direct form: SHA-256 of the certificate) and the jti replay row in this organization's store, which
//      every request for the organization shares (one single writer; R2-L2);
//   4. owner-interface actions only: the home delegation status (the `status` port caches ≤ 60 s; unreachable fails);
//   5. `aep` against the membership's recorded epoch (ORG-2 `observeAuthority`): lower fails; higher, or a directory key
//      reset, is an authority reset that ORG-2 persists before anything is refused (R2-M1);
//   6. the membership live (again, after every await) and the organization's connection to `client.client_id`
//      `active` or `degraded` with `client.origin` its verified origin (§7.1).
// Failed presentations are rate-limited per network whatever step failed, and per client only once a member key verified
// the signature (so unsigned garbage naming an app cannot lock its members out); cost and result stay uniform.
//
// Same-host issuers are local: their certification keys are read from the member's own account into a bounded cache
// here (`cachedIssuerKeys`), refreshed in the background, so the request path costs the same for members, non-members
// and forgeries. Foreign issuers resolve through the ORG-7 directory hook, cache-only on the request path, and only
// with ORG_FOREIGN_MEMBERS_ENABLED and an explicit issuer allowlist (empty by default; R2-M6).
//
// Records (the organization's account store):
//   org/cert/settings                 {certificateSeconds}: the organization's lifetime (60–660 s, default 660); 3sln.me
//                                     as a home issuer honours it, and this verifier caps effective lifetime with it
//   org/cert/token/<sha256(token)>    member-context tokens: DPoP-bound to (organization, membership, client, jkt),
//                                     `exp` ≤ the certificate's, no refresh token
//   org/cert/proof/<sha256(jkt,jti)>  DPoP replay rows until the proof window ends
//   org/cert/key-epoch/<principal>    the highest directory key-reset epoch seen for a member (foreign issuers)
//   org/cert/keys/<principal>         the same-host certification key cache (TTL 300 s, negative 60 s)
//   org/cert/refresh/<dueAt>/<principal>  the refresh queue, time-ordered (packages/orgs/key-refresh.mjs, F-07): filled
//                                     by roster discovery (the batch scales so the whole roster is checked about every
//                                     TTL/4), by ORG-2 at join and at an authority-epoch observation, by a same-host
//                                     issuance hint (`hint`), and by the request path ('claimed', bounded); exponential
//                                     back-off; run after the uniform answer
import { Provider } from '../../vendor/ngin/index.js';
import { AppAction, AppQuery } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { base64url, textEncoder } from '../core/records.mjs';
import { verifyProof, DPOP_TYP } from '../federation/dpop.mjs';
import { enqueueMemberKeyRefresh, dueMemberKeyRefreshes, removeMemberKeyRefresh, rescheduleMemberKeyRefresh, nextMemberKeyRefresh, MEMBER_REFRESH_CLAIMED } from './key-refresh.mjs';
import { parseMemberCertificate, verifyMemberSignature, memberHolderKey, memberCertificateLifetime, MEMBER_PURPOSES, MEMBER_CERTIFICATE_DEFAULT_SECONDS, MEMBER_CERTIFICATE_MIN_SECONDS } from '../identity/member-certificates.mjs';

export const ORG_FOREIGN_MEMBERS_FLAG = 'ORG_FOREIGN_MEMBERS_ENABLED';
export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const MEMBER_SKEW_SECONDS = 60, MEMBER_PROOF_WINDOW_SECONDS = 60, MEMBER_KEY_CACHE_MS = 300000, MEMBER_KEY_NEGATIVE_MS = 60000;
export const MEMBER_FAILURE_LIMITS = Object.freeze({ windowMs: 60000, client: 60, network: 120 });
export const MEMBER_TOKENS_PER_MEMBERSHIP = 64, MEMBER_TOKEN_LIMIT = 4096, MEMBER_REFRESH_QUEUE = MEMBER_REFRESH_CLAIMED, MEMBER_DISCOVERY_MS = 60000, MEMBER_DISCOVERY_BATCH = 64, MEMBER_DISCOVERY_MAX_BATCH = 8192;
/** Discovery batch for a roster of `n`: the whole roster is checked about every TTL/4 (F-07), within 64..8192. */
export const memberDiscoveryBatch = n => Math.min(MEMBER_DISCOVERY_MAX_BATCH, Math.max(MEMBER_DISCOVERY_BATCH, Math.ceil(n * MEMBER_DISCOVERY_MS / (MEMBER_KEY_CACHE_MS / 4))));
/** Default refreshes per refreshDue run for a roster of `n`: ceil(n/64) within 16..128. */
export const memberRefreshLimit = n => Math.min(128, Math.max(16, Math.ceil(n / 64)));
const SETTINGS = 'org/cert/settings', TOKEN = 'org/cert/token/', PROOF = 'org/cert/proof/', KEY_EPOCH = 'org/cert/key-epoch/', KEYS = 'org/cert/keys/', KEYS_DUE = 'org/cert/keys-due/';
/** Request-path claims waiting for the background run (review follow-up 3), deduplicated and bounded in memory. */
export const MEMBER_DEFERRED_CLAIMS = 256;
const pad15 = at => String(Math.max(0, Math.min(Math.floor(at), 999999999999999))).padStart(15, '0');
const TOKEN_PATTERN = /^mc_[A-Za-z0-9_-]{43}$/, CERT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, names) => plain(value) && Object.keys(value).every(name => names.includes(name));
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const fault = (code, message, status) => { throw new AppFault(code, message, status); };
/** The one token-endpoint failure (spec §7.3): status 400, body exactly {error:'invalid_grant'}. */
export const MEMBER_TOKEN_FAILURE = Object.freeze({ status: 400, body: Object.freeze({ error: 'invalid_grant' }) });
/** The one direct-form and token-use failure: status 401, body exactly {error:'invalid_token'}. */
export const MEMBER_DIRECT_FAILURE = Object.freeze({ status: 401, body: Object.freeze({ error: 'invalid_token' }) });
const tokenFailure = () => fault('invalid_grant', 'invalid_grant', 400);
const directFailure = () => fault('invalid_token', 'invalid_token', 401);
/** Store key of a principal: the same encoding as ORG-2's principalKey. */
export const memberPrincipalKey = principal => encodeURIComponent(JSON.stringify([principal?.iss ?? null, principal?.sub]));
/** ORG-2 provenance of a certificate-authenticated member: the identity signing key the identity document lists as
 * active (continuity-pinned by ORG-7 for foreign issuers, read locally for same-host ones) and the certification kid. */
export const memberProvenance = (key, certificationKid) => key?.signing ? { kid: key.signing.kid, publicKey: { ...key.signing.publicJwk }, certificationKid, authentication: 'member-certificate', identity: key.identity } : null;
const sha = async (crypto, text) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(text))));

// A fixed dummy key and input: the step-1-failed and key-missing paths verify a real ECDSA signature of the same shape.
let dummy;
async function dummyCheck(crypto) {
  dummy ??= (async () => { const pair = await crypto.subtle.generateKey(P256, false, ['sign', 'verify']), input = textEncoder.encode('bindle-member-certificate-dummy'); return { key: pair.publicKey, input, signature: new Uint8Array(await crypto.subtle.sign(ES256, pair.privateKey, input)).map((b, i) => i === 0 ? b ^ 1 : b) }; })();
  const { key, input, signature } = await dummy; try { await crypto.subtle.verify(ES256, key, signature, input); } catch { /* same cost either way */ }
  return false;
}

/** Same-host certification keys, cached in the organization's store. `read(subject)` -> {identity, keys:[{kid,
 * publicJwk, state}]} | null is a local read of the member's own account (never a network fetch). `resolve` is
 * cache-only and costs one store read for any claimed subject; `refresh` runs in the background. */
export function cachedIssuerKeys({ metadata, issuer, read, clock = () => Date.now(), ttlMs = MEMBER_KEY_CACHE_MS, negativeMs = MEMBER_KEY_NEGATIVE_MS }) {
  const path = subject => KEYS + memberPrincipalKey({ iss: issuer, sub: subject });
  return Object.freeze({
    async resolve({ issuer: iss, subject, kid, identity }) {
      if (iss !== issuer || typeof subject !== 'string' || typeof kid !== 'string') return null;
      const row = await metadata.get(path(subject)), now = clock();
      if (!plain(row) || !(row.until > now) || typeof row.identity !== 'string' || (identity !== undefined && identity !== row.identity)) return null;
      const entry = Array.isArray(row.keys) ? row.keys.find(k => k?.kid === kid && k.state === 'active') : null;
      return entry ? { publicJwk: { kty: 'EC', crv: 'P-256', x: entry.publicJwk.x, y: entry.publicJwk.y }, identity: row.identity, authorityEpoch: 0, signing: row.signing ? { kid: row.signing.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: row.signing.publicJwk.x, y: row.signing.publicJwk.y } } : null, stale: row.until - now < ttlMs / 2 } : null;
    },
    /** Background discovery only (never the request path): missing, expired or half-way stale cache rows. */
    async needsRefresh({ issuer: iss, subject }) {
      if (iss !== issuer || typeof subject !== 'string') return false;
      const row = await metadata.get(path(subject)), now = clock();
      return !plain(row) || !(row.until > now) || (row.identity !== null && row.until - now < ttlMs / 2);
    },
    /** `negative: false` (a request-path 'claimed' refresh) never stores a negative row, so unauthenticated claims
     * cannot grow the cache (review follow-up 1). Every stored row is indexed by its expiry for `prune`. */
    async refresh({ issuer: iss, subject, negative = true }) {
      if (iss !== issuer || typeof subject !== 'string') return null;
      const found = await read(subject), now = clock();
      const signing = plain(found?.signing) && typeof found.signing.kid === 'string' && typeof found.signing.publicJwk?.x === 'string' ? { kid: found.signing.kid, publicJwk: { x: found.signing.publicJwk.x, y: found.signing.publicJwk.y } } : null;
      const row = found && typeof found.identity === 'string' && Array.isArray(found.keys) ? { identity: found.identity, signing, keys: found.keys.filter(k => ['active', 'retired', 'revoked'].includes(k?.state)).slice(0, 16).map(k => ({ kid: k.kid, state: k.state, publicJwk: { x: k.publicJwk.x, y: k.publicJwk.y } })), until: now + ttlMs } : { identity: null, keys: [], until: now + negativeMs };
      if (row.identity === null && !negative) return false;
      await metadata.transaction(async tx => { await tx.put(path(subject), row); await tx.put(KEYS_DUE + pad15(row.until) + '/' + memberPrincipalKey({ iss: issuer, sub: subject }), 1); });
      return row.identity !== null;
    },
    /** Deletes cache rows that have expired, through the expiry index (at most `limit` index entries; stale entries of
     * rows refreshed since are dropped without touching the row). Returns {removed, more}. */
    async prune({ limit = 64 } = {}) {
      const now = clock();
      return metadata.transaction(async tx => {
        let removed = 0, scanned = 0;
        for (const [key] of await tx.list({ prefix: KEYS_DUE, limit })) {
          const rest = key.slice(KEYS_DUE.length), at = Number(rest.slice(0, 15)); if (!(at <= now)) return { removed, more: false };
          scanned++;
          const rowKey = KEYS + rest.slice(16), row = await tx.get(rowKey);
          if (plain(row) && !(row.until > now)) { await tx.delete(rowKey); removed++; }
          await tx.delete(key);
        }
        return { removed, more: scanned === limit };
      });
    },
  });
}
/** The ORG-7 directory hook as a foreign key port (cache-only resolve, background refresh). */
export function directoryIssuerKeys(directory) {
  return Object.freeze({
    async resolve({ issuer, subject, kid, identity }) {
      const found = await directory?.resolve?.({ issuer, subject, kid, purpose: 'certification', ...identity === undefined ? {} : { identity } });
      if (found?.purpose !== 'certification' || found.state !== 'active') return null;
      // Signing-key provenance: the pinned active signing key of the cached document (ORG-7 pins it; cache-only).
      const sig = directory.cache?.get?.(`${issuer}\n${subject}`)?.document?.keys?.find(k => k.use === 'sig' && k.state === 'active');
      const signing = sig ? await directory.resolve({ issuer, subject, kid: sig.kid, purpose: 'signing', identity: found.identity }) : null;
      return { publicJwk: found.publicJwk, identity: found.identity, authorityEpoch: nonNegative(found.authorityEpoch) ? found.authorityEpoch : 0, signing: signing ? { kid: signing.kid, publicJwk: signing.publicJwk } : null };
    },
    /** Background discovery only: the directory has no cached document for this member. */
    async needsRefresh({ issuer, subject }) { const entry = directory?.cache?.get?.(`${issuer}\n${subject}`); const now = typeof directory?.clock === 'function' ? directory.clock() : Date.now(); return !entry || !(entry.until > now); },
    async refresh({ issuer, subject }) { await directory?.refresh?.({ issuer, subject }); return true; },
  });
}

export class MemberContextService {
  /** `metadata`: the organization's account store. `organization`: {id, identity} (its identity URI is the `aud`).
   * `issuer`: this provider's origin. `members`: the ORG-2 port {lookup(principal) -> {id, generation, aep, label?} |
   * null (live memberships only, no network), observe(principal, {aep, reset}) (throws when stale), context(principal,
   * {client, generation}) -> {membership_id, generation}}. `successors.origin(principal)` -> origin principal | null.
   * `local`/`foreign`: key ports (cachedIssuerKeys / directoryIssuerKeys). `connections.check({clientId, origin})` ->
   * boolean. `status({issuer, subject, jkt})` -> 'active' | 'revoked' (owner-interface step 4). `flags`: {organizations(),
   * foreign()}. `foreignIssuers`: the allowlist (empty by default). */
  constructor({ metadata, organization, issuer, members, successors, local, foreign, connections, status, flags = {}, foreignIssuers = [], clock = () => Date.now(), crypto = globalThis.crypto, random, allowLoopback = false, failureLimits = MEMBER_FAILURE_LIMITS }) {
    if (typeof metadata?.transaction !== 'function' || typeof metadata.get !== 'function') throw new TypeError('Member context needs the organization account store.');
    Object.assign(this, { metadata, organization, issuer, members, successors, local, foreign, connections, status, flags, foreignIssuers: new Set(foreignIssuers), clock, crypto, random: random ?? (n => crypto.getRandomValues(new Uint8Array(n))), allowLoopback: allowLoopback === true, failureLimits });
    this.failures = new Map(); this.discovery = { at: -Infinity, cursor: 0, after: '', size: 0 }; this.deferred = new Map();
  }
  #flag(name) { try { return this.flags?.[name]?.() === true; } catch { return false; } }
  foreignAllowed(iss) { return iss !== this.issuer && this.#flag('foreign') && this.foreignIssuers.has(iss); }
  async settings() { const row = await this.metadata.get(SETTINGS); return { certificateSeconds: memberCertificateLifetime(row?.certificateSeconds) ?? MEMBER_CERTIFICATE_DEFAULT_SECONDS }; }

  // ---- failure budgets (identical whatever step failed) ----
  #blocked(keys) { const now = this.clock(); return keys.some(([k, limit]) => { const row = this.failures.get(k); return row && row.start + this.failureLimits.windowMs > now && row.count >= limit; }); }
  #failed(keys) {
    const now = this.clock();
    for (const [k] of keys) { const row = this.failures.get(k); if (!row || row.start + this.failureLimits.windowMs <= now) this.failures.set(k, { start: now, count: 1 }); else row.count++; }
    if (this.failures.size > 4096) for (const [k, row] of this.failures) if (row.start + this.failureLimits.windowMs <= now) this.failures.delete(k);
  }
  #budget(client, network) { return [[`client\0${typeof client === 'string' ? client.slice(0, 256) : '?'}`, this.failureLimits.client], [`network\0${typeof network === 'string' ? network.slice(0, 128) : '?'}`, this.failureLimits.network]]; }

  async #origin(principal) { if (typeof this.successors?.origin !== 'function') return principal; try { return await this.successors.origin(principal); } catch { return null; } }
  async #lookup(principal) { if (!principal) return null; try { const found = await this.members?.lookup?.(principal); return plain(found) && typeof found.id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(found.id) && nonNegative(found.aep ?? 0) ? found : null; } catch { return null; } }
  async #key(claims, kid) {
    const port = claims.iss === this.issuer ? this.local : this.foreignAllowed(claims.iss) ? this.foreign : null;
    try { return port ? await port.resolve({ issuer: claims.iss, subject: claims.sub, kid, identity: claims.identity }) : null; } catch { return null; }
  }
  async #schedule(principal, source = 'member') {
    try { return await this.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, principal, { now: this.clock(), source, cap: this.discovery.size + MEMBER_REFRESH_CLAIMED })); } catch { return false; /* a refresh is best effort */ }
  }
  /** The key port of a claimed issuer: local, an allowed foreign issuer, or none. */
  #port(iss) { return iss === this.issuer ? this.local : this.foreignAllowed(iss) ? this.foreign : null; }
  /** Request path (F-07, review follow-up 3): remembers the claimed principal in memory only (no store work, the same
   * for anyone); the cache check and the bounded enqueue run in the background run after the uniform answer. */
  #defer(claims) {
    if (!claims || typeof claims.sub !== 'string' || typeof claims.iss !== 'string' || !this.#port(claims.iss)) return;
    const key = claims.iss + '\n' + claims.sub; this.deferred.delete(key);
    if (this.deferred.size >= MEMBER_DEFERRED_CLAIMS) this.deferred.delete(this.deferred.keys().next().value);
    this.deferred.set(key, { iss: claims.iss, sub: claims.sub });
  }
  async #flushDeferred() { const claims = [...this.deferred.values()]; this.deferred.clear(); for (const claim of claims) await this.#claimed(claim); }
  /** Background: the same check and, when the cache needs it, the same bounded enqueue for any valid claimed principal,
   * whatever its membership. */
  async #claimed(claims) {
    if (!claims || typeof claims.sub !== 'string' || typeof claims.iss !== 'string') return;
    const port = this.#port(claims.iss); if (typeof port?.needsRefresh !== 'function') return;
    let needed = false; try { needed = await port.needsRefresh({ issuer: claims.iss, subject: claims.sub }) === true; } catch { needed = false; }
    if (needed) await this.#schedule({ iss: claims.iss, sub: claims.sub }, 'claimed');
  }
  async #replay(proof) {
    const path = PROOF + await sha(this.crypto, `member-dpop\0${proof.jkt}\0${proof.jti}`), now = this.clock();
    return this.metadata.transaction(async tx => {
      if (await tx.get(path)) return false;
      let pruned = 0; for (const [k, row] of await tx.list({ prefix: PROOF, limit: 64 })) if (!(row?.expiresAt > now) && pruned++ < 32) await tx.delete(k);
      await tx.put(path, { expiresAt: Math.max(proof.expiresAt, now + 1000) }); return true;
    });
  }

  /** Steps 1–6. Never throws for a verification failure: {ok:false} | {ok:true, context}. `input`: {certificate,
   * proof, htm, htu, purpose, ath?, clientId?, ownerInterface?, network?, admit?}. `admit(principal)` replaces the
   * membership lookup for invitation acceptance (spec §5.1: the presented live invitation). */
  async verify(input) {
    const now = this.clock(), seconds = Math.floor(now / 1000);
    let parsed = null, claims = null, ok = true;
    try { parsed = parseMemberCertificate(input.certificate, { allowLoopback: this.allowLoopback }); claims = parsed.payload; } catch { ok = false; }
    const budget = this.#budget(claims?.client?.client_id ?? input.clientId, input.network);
    if (this.#blocked(budget)) { await dummyCheck(this.crypto); return { ok: false }; }
    // Review M4: unsigned garbage naming an app must not exhaust that app's budget for its genuine members, so the per-app
    // budget is charged only once a member key verified the signature; the per-network budget is always charged. Cost
    // and result stay uniform (the dummy check still runs whenever the signature is not computed).
    const trace = { signed: false };
    const result = await this.#steps(input, parsed, claims, ok, now, seconds, trace).catch(() => ({ ok: false }));
    if (!result.ok) this.#failed(trace.signed ? budget : budget.slice(1));
    return result;
  }
  async #steps(input, parsed, claims, ok, now, seconds, trace = {}) {
    const settings = await this.settings(), purpose = input.purpose ?? MEMBER_PURPOSES.access;
    if (!this.#flag('organizations')) ok = false;
    // Step 1: everything checkable offline, then the membership (no fetch).
    if (claims) {
      if (claims.aud !== this.organization?.identity || !claims.purposes.includes(purpose)) ok = false;
      if (input.clientId !== undefined && claims.client.client_id !== input.clientId) ok = false;
      if (seconds > claims.exp + MEMBER_SKEW_SECONDS || claims.iat > seconds + MEMBER_SKEW_SECONDS || seconds > claims.iat + settings.certificateSeconds + MEMBER_SKEW_SECONDS) ok = false;
    }
    const claimed = claims ? { iss: claims.iss, sub: claims.sub } : null, principal = claimed ? await this.#origin(claimed) : null;
    const member = principal ? typeof input.admit === 'function' ? await Promise.resolve(input.admit(principal)).catch(() => null) : await this.#lookup(principal) : null;
    if (!member) ok = false;
    // Step 2: the signature, always computed; the key is resolved for the claimed principal whatever step 1 said.
    const key = claims ? await this.#key(claims, parsed.header.kid) : null;
    const signed = key && member && claims ? await verifyMemberSignature(parsed, key.publicJwk, this.crypto) : await dummyCheck(this.crypto);
    if (!signed || !key || key.identity !== claims?.identity) ok = false;
    trace.signed = Boolean(signed && key && member && claims);
    // Review LM1 / F-07 / follow-up 3: the claimed principal is only remembered in memory here, the same for anyone; its
    // cache check and enqueue run in the background run after the uniform answer, so no response cost depends on it.
    this.#defer(claims);
    if (!ok) return { ok: false };
    // Step 3: the proof by the certified key, then its replay row.
    const holder = await memberHolderKey(claims, this.crypto); if (!holder) return { ok: false };
    let proof; try { proof = await verifyProof(this.crypto, input.proof, { typ: DPOP_TYP, htm: input.htm, htu: input.htu, now, window: MEMBER_PROOF_WINDOW_SECONDS, ...input.ath === undefined ? {} : { ath: input.ath } }); } catch { return { ok: false }; }
    if (proof.jkt !== claims.cnf.jkt) return { ok: false };
    if (!await this.#replay(proof)) return { ok: false };
    // Step 4: owner-interface actions only, failing closed.
    if (input.ownerInterface === true) { let state; try { state = await this.status?.({ issuer: claims.iss, subject: claims.sub, jkt: claims.cnf.jkt }); } catch { state = null; } if (state !== 'active') return { ok: false }; }
    if (typeof input.admit === 'function') return { ok: true, context: this.#context(principal, member, claims, key, parsed.header.kid) };
    // Step 5: the authority epoch, and a directory key reset (foreign issuers), persisted by ORG-2 before any refusal.
    let reset = false;
    if (claims.iss !== this.issuer && nonNegative(key.authorityEpoch)) reset = await this.metadata.transaction(async tx => { const path = KEY_EPOCH + memberPrincipalKey(principal), seen = await tx.get(path); if (nonNegative(seen) && key.authorityEpoch < seen) return null; if (!nonNegative(seen) || key.authorityEpoch > seen) { await tx.put(path, key.authorityEpoch); return nonNegative(seen); } return false; });
    if (reset === null) return { ok: false };
    const addedUnder = memberProvenance(key, parsed.header.kid);
    try { await this.members.observe(principal, { aep: claims.aep, reset, ...addedUnder ? { addedUnder } : {} }); } catch { return { ok: false }; }
    // Step 6: membership and connection, live.
    const live = await this.#lookup(principal);
    if (!live || live.id !== member.id || live.generation !== member.generation || claims.aep < (live.aep ?? 0)) return { ok: false };
    let connected = false; try { connected = await this.connections?.check?.({ clientId: claims.client.client_id, origin: claims.client.origin }) === true; } catch { connected = false; }
    if (!connected) return { ok: false };
    return { ok: true, context: this.#context(principal, live, claims, key, parsed.header.kid) };
  }
  #context(principal, member, claims, key, kid) {
    return { principal: { ...principal }, presented: { iss: claims.iss, sub: claims.sub }, membership: { id: member.id ?? null, generation: member.generation ?? null, ...typeof member.label === 'string' ? { label: member.label } : {} }, client: { ...claims.client }, jkt: claims.cnf.jkt, aep: claims.aep, certificate: { jti: claims.jti, iat: claims.iat, exp: claims.exp }, addedUnder: memberProvenance(key, kid) };
  }

  /** Token form (spec §7.1, §7.2). `input`: {assertion, clientId, dpop, htu, network?}. Returns the token response or
   * throws the uniform `invalid_grant`. */
  async admitToken(input) {
    if (!only(input, ['assertion', 'clientId', 'dpop', 'htu', 'network']) || typeof input.assertion !== 'string' || !CERT_PATTERN.test(input.assertion) || typeof input.clientId !== 'string' || typeof input.dpop !== 'string' || typeof input.htu !== 'string') { await this.verify({ certificate: null, network: input?.network }); tokenFailure(); }
    const verified = await this.verify({ certificate: input.assertion, proof: input.dpop, htm: 'POST', htu: input.htu, purpose: MEMBER_PURPOSES.access, clientId: input.clientId, network: input.network });
    if (!verified.ok) tokenFailure();
    const context = verified.context, now = this.clock(), settings = await this.settings();
    const exp = Math.min(context.certificate.exp, context.certificate.iat + settings.certificateSeconds), expiresIn = exp - Math.floor(now / 1000);
    if (expiresIn < 1) tokenFailure();
    // ORG-2 remembers the client so `member-removed` reaches it when the membership ends (§5.4, §7.4).
    let recorded; try { recorded = await this.members.context(context.principal, { client: context.client.client_id, generation: context.membership.generation }); } catch { recorded = null; }
    if (recorded?.membership_id !== context.membership.id) tokenFailure();
    return { context, exp, expiresIn, bindle_member: this.#public(context), member: { principal: { ...context.principal }, membership_id: context.membership.id, generation: context.membership.generation, aep: context.aep, client: context.client.client_id, ...context.addedUnder ? { addedUnder: structuredClone(context.addedUnder) } : {} } };
  }
  /** Token form with this store's own member-context tokens (engine placement and the direct `authenticate`). The
   * runtime instead mints the DPoP-bound FEDERATION access token carrying `member` (ORG-3's `token.member`) from
   * `admitToken`'s result (packages/federation/member-access.mjs), so RPC runs the live §6.2 intersection. */
  async token(input) {
    const { context, exp, expiresIn } = await this.admitToken(input), now = this.clock();
    const token = `mc_${base64url(this.random(32))}`, hash = await sha(this.crypto, `member-token\0${token}`);
    // Expired rows are pruned in their own transaction, so a refusal below never rolls the cleanup back; only live rows
    // count toward the limit (plausible item 7).
    await this.metadata.transaction(async tx => { for (const [k, row] of await tx.list({ prefix: TOKEN })) if (!(row?.exp * 1000 > now)) await tx.delete(k); });
    await this.metadata.transaction(async tx => {
      const live = [...await tx.list({ prefix: TOKEN, limit: MEMBER_TOKEN_LIMIT + 1 })].filter(([, row]) => row?.exp * 1000 > now), mine = live.filter(([, row]) => row.membership === context.membership.id);
      mine.sort((a, b) => a[1].createdAt - b[1].createdAt); const evict = mine.slice(0, Math.max(0, mine.length + 1 - MEMBER_TOKENS_PER_MEMBERSHIP));
      if (live.length - evict.length >= MEMBER_TOKEN_LIMIT) fault('rate_limited', 'Too many member sessions.', 429);
      for (const [k] of evict) await tx.delete(k);
      await tx.put(TOKEN + hash, { membership: context.membership.id, generation: context.membership.generation, principal: context.principal, client: context.client, jkt: context.jkt, aep: context.aep, exp, certificate: context.certificate.jti, createdAt: now });
    });
    return { access_token: token, token_type: 'DPoP', expires_in: expiresIn, bindle_member: { entity: this.organization.identity, id: context.membership.id, ...typeof context.membership.label === 'string' ? { label: context.membership.label } : {} } };
  }
  /** Direct form (spec §5.2): `Authorization: BindleMember <certificate>` with a DPoP proof whose `ath` is the
   * SHA-256 of the certificate. `input`: {authorization, dpop, htm, htu, network?, ownerInterface?}. */
  async direct(input) {
    const match = typeof input?.authorization === 'string' && /^BindleMember ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(input.authorization);
    if (!match || typeof input.dpop !== 'string' || typeof input.htm !== 'string' || typeof input.htu !== 'string') { await this.verify({ certificate: null, network: input?.network }); directFailure(); }
    const verified = await this.verify({ certificate: match[1], proof: input.dpop, htm: input.htm, htu: input.htu, ath: match[1], purpose: MEMBER_PURPOSES.access, network: input.network, ownerInterface: input.ownerInterface === true });
    if (!verified.ok) directFailure();
    return { member: this.#public(verified.context), context: verified.context };
  }
  /** A member-context access token on a request: `Authorization: DPoP <token>` plus a proof with `ath` = SHA-256 of the
   * token. Bearer is refused. The membership, its generation, the epoch and the connection are checked live. */
  async authenticate(input) {
    const match = typeof input?.authorization === 'string' && /^DPoP (mc_[A-Za-z0-9_-]{43})$/.exec(input.authorization);
    const fail = () => { this.#failed(this.#budget(undefined, input?.network)); directFailure(); };
    if (!match || typeof input.dpop !== 'string' || typeof input.htm !== 'string' || typeof input.htu !== 'string' || !this.#flag('organizations')) fail();
    if (this.#blocked(this.#budget(undefined, input.network))) directFailure();
    const token = match[1], hash = await sha(this.crypto, `member-token\0${token}`), now = this.clock(), row = await this.metadata.get(TOKEN + hash);
    if (!plain(row) || !(row.exp * 1000 > now)) fail();
    let proof; try { proof = await verifyProof(this.crypto, input.dpop, { typ: DPOP_TYP, htm: input.htm, htu: input.htu, now, window: MEMBER_PROOF_WINDOW_SECONDS, ath: token }); } catch { fail(); }
    if (proof.jkt !== row.jkt || !await this.#replay(proof)) fail();
    const live = await this.#lookup(row.principal);
    if (!live || live.id !== row.membership || live.generation !== row.generation || row.aep < (live.aep ?? 0)) fail();
    let connected = false; try { connected = await this.connections?.check?.({ clientId: row.client.client_id, origin: row.client.origin }) === true; } catch { connected = false; }
    if (!connected) fail();
    const context = { principal: { ...row.principal }, membership: { id: row.membership, generation: row.generation, ...typeof live.label === 'string' ? { label: live.label } : {} }, client: { ...row.client }, jkt: row.jkt, aep: row.aep, token: { exp: row.exp } };
    return { member: this.#public(context), context };
  }
  #public(context) { return { entity: this.organization.identity, id: context.membership.id, ...typeof context.membership.label === 'string' ? { label: context.membership.label } : {} }; }

  /** System: ends member-context tokens, by membership (ORG-2 ending a membership, §5.4) or by principal (a home
   * `connection-revoked`, which is also an authority reset, §5.2a). */
  async end(input) {
    if (!only(input, ['membership', 'principal', 'reset']) || (input.membership === undefined) === (input.principal === undefined)) fault('invalid_request', 'Name a membership or a principal.', 400);
    const principal = input.principal === undefined ? null : await this.#origin(input.principal), key = principal ? memberPrincipalKey(principal) : null;
    const ended = await this.metadata.transaction(async tx => { let n = 0; for (const [k, row] of await tx.list({ prefix: TOKEN })) if (input.membership !== undefined ? row?.membership === input.membership : memberPrincipalKey(row?.principal) === key) { await tx.delete(k); n++; } return n; });
    if (principal && input.reset === true) { const member = await this.#lookup(principal); if (member) await this.members.observe(principal, { aep: member.aep ?? 0, reset: true }); }
    return { ended };
  }
  /** Background only: enqueue live members whose cached keys are missing or stale. `members.roster(page)` -> an
   * array of live {iss, sub}, or a page {principals, next, total} for `{after, limit}`. The batch scales with the
   * roster (memberDiscoveryBatch); passes are at most once per MEMBER_DISCOVERY_MS. */
  async #discover(now) {
    if (typeof this.members?.roster !== 'function' || now - this.discovery.at < MEMBER_DISCOVERY_MS) return;
    this.discovery.at = now;
    let batch = memberDiscoveryBatch(this.discovery.size), principals = [];
    try {
      const first = await this.members.roster({ after: this.discovery.after, limit: batch });
      if (Array.isArray(first)) {
        this.discovery.size = first.length; batch = memberDiscoveryBatch(first.length); if (!first.length) return;
        const start = this.discovery.cursor % first.length, count = Math.min(first.length, batch); this.discovery.cursor = start + count;
        for (let i = 0; i < count; i++) principals.push(first[(start + i) % first.length]);
      } else if (plain(first) && Array.isArray(first.principals)) {
        if (nonNegative(first.total)) this.discovery.size = first.total;
        let page = first; principals.push(...page.principals);
        while (principals.length < batch && typeof page.next === 'string' && page.next) { page = await this.members.roster({ after: page.next, limit: batch - principals.length }); if (!plain(page) || !Array.isArray(page.principals)) break; principals.push(...page.principals); }
        this.discovery.after = typeof page?.next === 'string' ? page.next : '';
      } else return;
    } catch { return; }
    for (const principal of principals.slice(0, MEMBER_DISCOVERY_MAX_BATCH)) {
      if (!plain(principal) || typeof principal.sub !== 'string') continue;
      const iss = principal.iss ?? this.issuer, port = this.#port(iss);
      let needed = false; try { needed = typeof port?.needsRefresh === 'function' && await port.needsRefresh({ issuer: iss, subject: principal.sub }) === true; } catch { needed = false; }
      if (needed) await this.#schedule({ iss, sub: principal.sub });
    }
  }
  /** System, background: performs due key refreshes (time-ordered queue; reads only due rows). Returns {done, wakeAt}. */
  async refreshDue({ limit } = {}) {
    await this.#flushDeferred();
    try { await this.local?.prune?.({ limit: 64 }); } catch { /* best effort */ }
    await this.#discover(this.clock());
    const now = this.clock(), max = Number.isSafeInteger(limit) && limit > 0 ? limit : memberRefreshLimit(this.discovery.size);
    const due = await this.metadata.transaction(tx => dueMemberKeyRefreshes(tx, now, max));
    let done = 0;
    for (const [path, row] of due) {
      const issuer = row.issuer ?? this.issuer, port = this.#port(issuer);
      // A 'claimed' (request-path) refresh never stores a negative row (review follow-up 1); its row leaves the queue.
      let ok = false; try { ok = port ? await port.refresh({ issuer, subject: row.subject, negative: row.source !== 'claimed' }) !== false || row.source === 'claimed' : false; } catch { ok = false; }
      await this.metadata.transaction(async tx => { if (ok || !port || row.attempts >= 4) await removeMemberKeyRefresh(tx, path); else await rescheduleMemberKeyRefresh(tx, path, { attempts: row.attempts + 1, dueAt: now + 60000 * 2 ** row.attempts }); });
      if (ok) done++;
    }
    const next = await this.metadata.transaction(tx => nextMemberKeyRefresh(tx));
    return { done, wakeAt: next === null ? null : Math.max(now + 1000, next) };
  }
  /** System: a same-host issuance, acquisition or revocation hint for `subject` at this provider. Enqueues a refresh
   * for a live member only, then runs due refreshes; the answer is the same whether or not `subject` is a member. */
  async hint(input) {
    if (!only(input, ['subject']) || typeof input.subject !== 'string' || !/^[0-9a-f-]{36}$/.test(input.subject)) fault('invalid_request', 'Name a subject.', 400);
    const principal = { iss: this.issuer, sub: input.subject };
    if (await this.#lookup(principal)) await this.#schedule(principal);
    try { await this.refreshDue(); } catch { /* best effort */ }
    return { accepted: true };
  }
  /** System: drops expired tokens and replay rows. */
  async sweep() {
    const now = this.clock();
    let keys = 0; try { for (let more = true; more;) { const step = await this.local?.prune?.({ limit: 64 }); keys += step?.removed ?? 0; more = step?.more === true; } } catch { /* best effort */ }
    return this.metadata.transaction(async tx => { let removed = keys; for (const prefix of [TOKEN, PROOF]) for (const [k, row] of await tx.list({ prefix })) if (!((prefix === TOKEN ? row?.exp * 1000 : row?.expiresAt) > now)) { await tx.delete(k); removed++; } return { removed }; });
  }
  /** Admin: the organization's certificate lifetime (60–660 s). `actor` is a resolved ORG-0 organization actor. */
  async setSettings(actor, input) {
    if (actor?.kind !== 'owner' || actor.entity?.kind !== 'organization' || actor.owner !== this.organization?.id || !Array.isArray(actor.powers) || !actor.powers.includes('admin')) fault('not_found', 'Not found.', 404);
    if (!only(input, ['certificateSeconds']) || !Number.isSafeInteger(input.certificateSeconds) || input.certificateSeconds < MEMBER_CERTIFICATE_MIN_SECONDS || input.certificateSeconds > MEMBER_CERTIFICATE_DEFAULT_SECONDS) fault('invalid_request', `Choose a certificate lifetime between ${MEMBER_CERTIFICATE_MIN_SECONDS} and ${MEMBER_CERTIFICATE_DEFAULT_SECONDS} seconds.`, 400);
    await this.metadata.transaction(tx => tx.put(SETTINGS, { certificateSeconds: input.certificateSeconds, updatedAt: this.clock(), by: { iss: actor.principal?.iss ?? null, sub: actor.principal?.sub } }));
    return this.settings();
  }
}

// ---- engine operations ------------------------------------------------------------------------------------------
// The adapter builds `{kind:'system', owner:<organization>}` for the wire forms (they carry their own credentials,
// verified here) and resolves ORG-0 actors for the settings operations.
export function memberContextProvider(service) { return class extends Provider { static deps = []; obtain() { return service; } release() {} }; }
class ContextAction extends AppAction { static deps = ['memberContext']; }
const system = actor => actor?.kind === 'system' ? actor : fault('forbidden', 'System only.', 403);
export class MemberToken extends ContextAction { static operation = 'orgs.member-token'; run({ memberContext }) { system(this.actor); return memberContext.token(this.input); } }
export class MemberTokenAdmit extends ContextAction { static operation = 'orgs.member-token-admit'; run({ memberContext }) { system(this.actor); return memberContext.admitToken(this.input); } }
export class MemberDirect extends ContextAction { static operation = 'orgs.member-direct'; run({ memberContext }) { system(this.actor); return memberContext.direct(this.input); } }
export class MemberAuthenticate extends ContextAction { static operation = 'orgs.member-authenticate'; run({ memberContext }) { system(this.actor); return memberContext.authenticate(this.input); } }
export class EndMemberTokens extends ContextAction { static operation = 'orgs.member-tokens-end'; static lifecycle = 'suspended'; run({ memberContext }) { system(this.actor); return memberContext.end(this.input); } }
export class MemberKeysChanged extends ContextAction { static operation = 'orgs.member-keys-changed'; static lifecycle = 'suspended'; run({ memberContext }) { system(this.actor); return memberContext.hint(this.input); } }
export class MemberKeyRefresh extends ContextAction { static operation = 'orgs.member-key-refresh'; static lifecycle = 'suspended'; run({ memberContext }) { system(this.actor); return memberContext.refreshDue(this.input ?? {}); } }
export class MemberContextSweep extends ContextAction { static operation = 'orgs.member-context-sweep'; static lifecycle = 'suspended'; run({ memberContext }) { system(this.actor); return memberContext.sweep(); } }
export class MemberCertificateSettings extends AppQuery { static operation = 'orgs.certificate-settings'; static deps = ['memberContext']; static entities = ['organization']; fetch({ memberContext }) { return memberContext.settings(); } }
export class SetMemberCertificateSettings extends ContextAction { static operation = 'orgs.set-certificate-settings'; static entities = ['organization']; run({ memberContext }) { return memberContext.setSettings(this.actor, this.input); } }
export const MEMBER_CONTEXT_OPERATIONS = Object.freeze([MemberToken, MemberTokenAdmit, MemberDirect, MemberAuthenticate, EndMemberTokens, MemberKeyRefresh, MemberKeysChanged, MemberContextSweep, MemberCertificateSettings, SetMemberCertificateSettings]);
/** Owner-route operations resolved with `accountActor` (ORG-0). */
export const MEMBER_CONTEXT_OWNER_OPERATIONS = Object.freeze([MemberCertificateSettings, SetMemberCertificateSettings]);
