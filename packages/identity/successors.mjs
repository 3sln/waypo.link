// PORT-5: verifier adoption of identity moves (docs/spec/identity-portability.md rev 3.2 §5.1, §7, §8; design §2.7,
// §4, §10.1). Engine-first: `SuccessorRegistry` is the verifier's provider resource (catalogued as `successors`) and
// the `successors.*` Actions/Queries at the end are its operations. Organizations and Parlay call this port; their
// owners wire it. PORT-4 (packages/identity/transfer-in.mjs) reuses the fetch client and the attestation-key pins.
//
// What this module owns:
//   - the portability fetch client (`portabilityClient`): manifests, directory `?sub=` lookups, identity documents,
//     attestation JWKS and the move endpoint, under the client-metadata fetch policy (packages/federation/
//     client-metadata.mjs): HTTPS on the default port, public DNS hosts only, no credentials, no redirects followed
//     (3xx are returned as data), exact statuses, JSON media types, bounded bodies and deadlines, and per-site plus
//     global budgets consumed BEFORE any egress. The raw `fetch` is the adapter's SSRF-safe egress port; for
//     adapters, `createPortabilityFetch` screens every DNS answer as the integration egress does;
//   - per-origin successor pins and the successor index (§8.1, §8.2), monotonic in `seq`;
//   - per-issuer attestation-key pins (§5.1, P16), with preconfigured roots (the shipped 3sln.me root,
//     packages/identity/attestation-keys.mjs), attestation resets (alerted, never adopted automatically) and
//     `attestation_first_use`;
//   - automatic adoption (§8.3) including the fetch-based items 4 and 5 that PORT-1 deferred, equivocation and replay
//     (§8.4), pending successors and explicit local adoption (§8.5), first contact (§8.6), the background-refresh hook
//     and presentation intake (§8.7).
//
// Flag: IDENTITY_SUCCESSOR_ADOPTION_ENABLED (class c, default off). Off: nothing is adopted, no first-contact chain is
// verified, presentations are dropped, and `resolve` answers only exact origin principals (an identity that never
// moved); certificates from moved identities therefore fail uniformly at the caller.
//
// Clarifications this implementation settles (recorded for the spec owner):
//   - §8.3 item 4 when a verifier is more than one move behind: intermediate hosts no longer serve the identity, so
//     item 4 is checked once, against the final destination, whose `moves` must carry every applied record byte for
//     byte; each record still passes items 1, 2, 3 and 5 (as §8.6 does for first contact).
//   - §8.3 item 5: a `308` without a parseable moved body counts as "let go"; any other 3xx, an invalid `200` and a
//     `200` naming `from.identity` fail closed. A `200` naming a different identity URI is a later return to that host
//     (spec §4 gives a return a new identity URI), which has let go of the old one, only when a later record of the
//     same chain moves the identity to exactly that URI; any other different URI fails closed (wargame F6).
//   - Pending successors (§8.5) are offered only for records whose items 1 and 2 pass and whose destination directory
//     check passes; the first failing record of a chain is the one offered.
//   - P16 pinning starts with the relationship: `track`, each adoption and each first contact also pin the current
//     host's attestation keys (best effort). A verifier holding a relationship has then seen the host's real keys
//     before any later lapse, which narrows the first-use residual to hosts that were unreachable at those moments.
//
// Store layout (any transactional store with get/set/delete/list, like packages/identity/keys.mjs):
//   successor/<iss>/<sub>/                pin, keyed by origin principal
//   successor-index/<iss>/<sub>/          {origin} for every adopted (to.iss, sub)
//   attestation-pin/<issuer>/             {thumbprints, firstUse, pinnedAt, resets}
//   successor-pending/<iss>/<sub>/<d>/    pending successor (at most PENDING_LIMIT per origin)
//   successor-source/<iss>/<sub>/         {since}: first failed item-5 lookup, for the 7-day rule
//   successor-queue/<id>/                 presented chains awaiting background verification (at most QUEUE_LIMIT)
import { AppAction, AppQuery } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { key } from '../core/records.mjs';
import { isUUID } from '../core/primitives.mjs';
import { strictJSON, exactMembers, plainObject } from '../links/envelope.mjs';
import { memoryLimiter, publicClientHost, clientSite } from '../federation/client-metadata.mjs';
import { publicAddress } from '../apps/form-fetch-policy.mjs';
import { parseMoveStatement, parseMoveAttestation, verifyMoveStatement, verifyMoveAttestation, verifyMoveRecordLink, statementDigest, evaluateAttestationKeys, attestationKeyThumbprint, documentLineage, httpsOrigin, MAX_MOVES, MAX_MOVES_DOCUMENT_BYTES, DOCUMENT_BYTES, MAX_DOCUMENT_KEYS, MAX_STATEMENT_BYTES, MAX_ATTESTATION_BYTES, SuccessionError } from './succession.mjs';

export const ADOPTION_FLAG = 'IDENTITY_SUCCESSOR_ADOPTION_ENABLED';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
// `documentBytes` is the §7 budget of a moved identity's document (derived in succession.mjs); a document without
// `moves` is held to DOCUMENT_BYTES (32 KiB, organizations §3a.3) after it is read.
export const PORTABILITY_LIMITS = Object.freeze({
  timeoutMs: 3000, manifestBytes: 65536, documentBytes: MAX_MOVES_DOCUMENT_BYTES, directoryBytes: 8192, jwksBytes: 16384, moveBytes: 16384,
  manifestTtl: HOUR, jwksFresh: HOUR, sourceGone: 7 * DAY, maxHops: 3, cacheEntries: 256,
  perSite: Object.freeze({ windowMs: MINUTE, limit: 30 }), global: Object.freeze({ windowMs: MINUTE, limit: 600 }),
});
export const PENDING_LIMIT = 8, QUEUE_LIMIT = 256;
/** Presented-chain queue (§8.7, wargame F8): at most `perOrigin` rows per origin principal (a new presentation evicts
 * that origin's most-tried, then oldest, row), retried with exponential backoff from `base` to `max`, and dropped after
 * `attempts` unavailable answers. A drain processes due rows in `nextAt` order, at most `perOriginPass` per origin. */
export const QUEUE_POLICY = Object.freeze({ perOrigin: 8, perOriginUnverified: 2, perOriginPass: 4, attempts: 8, base: 15 * MINUTE, max: DAY });
export const MANIFEST_PATH = '/.well-known/bindle/manifest.json';

export class PortabilityUnavailable extends Error {
  constructor(retryAfter = null) { super('The identity provider could not be reached.'); this.code = 'temporarily_unavailable'; this.retryAfter = retryAfter; }
}
const unavailable = retryAfter => { throw new PortabilityUnavailable(retryAfter); };
const fault = (code, message, status = 400) => { throw new AppFault(code, message, status); };
const time = value => Number.isSafeInteger(value) && value >= 0;

// ---- URLs -------------------------------------------------------------------------------------------------------

/** A URL the portability client may fetch: canonical HTTPS on the default port, a public DNS host (the client-metadata
 * host rule), no userinfo or fragment, at most 2048 characters. Returns the URL or null. */
export function portabilityURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (url.href !== value || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || value.includes('#') || !publicClientHost(url.hostname)) return null;
  return url;
}
/** An HTTPS URL on exactly `origin`, without query or fragment (manifest feature members). */
const onOrigin = (value, origin) => { const url = portabilityURL(value); return url && url.origin === origin && !url.search && !value.includes('?') ? value : null; };
/** The move endpoint's `authorize_url` (spec §5.2): an HTTPS URL on exactly `origin`; a query is allowed (a source may
 * carry the statement digest a destination-start authorization binds to, spec §6.1 item 1), a fragment is not. */
const authorizeOn = (value, origin) => { const url = portabilityURL(value); return url && url.origin === origin ? value : null; };
const identityOn = (value, origin) => { const url = portabilityURL(value); return Boolean(url) && url.origin === origin && !url.search && !value.includes('?'); };
const place = value => exactMembers(value, ['iss', 'identity']) && httpsOrigin(value.iss) && identityOn(value.identity, value.iss);

// ---- the fetch client ---------------------------------------------------------------------------------------------

async function boundedBytes(response, maxBytes, signal) {
  const length = response.headers?.get?.('Content-Length');
  if (length !== null && length !== undefined && (!/^\d{1,9}$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel?.().catch(() => {}); return null; }
  const reader = response.body?.getReader?.();
  if (!reader) { if (typeof response.arrayBuffer !== 'function') return new Uint8Array(); const bytes = new Uint8Array(await response.arrayBuffer()); return bytes.byteLength > maxBytes ? null : bytes; }
  const chunks = []; let size = 0;
  try { for (;;) { if (signal?.aborted) return null; const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel().catch(() => {}); return null; } chunks.push(value); } }
  finally { try { reader.releaseLock(); } catch {} }
  const out = new Uint8Array(size); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; } return out;
}
const JSON_TYPES = ['application/json', 'application/jwk-set+json'];

/** The portability fetch client. `fetch(url, init) -> Response` is the operator's SSRF-safe egress port; `limiter`
 * ({consume(name, {windowMs, limit})}) carries the budgets (in-memory by default, fleet-wide where available). */
export function portabilityClient({ fetch, limiter, clock = () => Date.now(), limits = PORTABILITY_LIMITS } = {}) {
  if (typeof fetch !== 'function') throw new TypeError('The portability client needs an egress fetch port.');
  const budgets = limiter ?? memoryLimiter({ clock }), manifests = new Map(), jwksCache = new Map();
  const remember = (map, name, value) => { map.delete(name); map.set(name, value); while (map.size > limits.cacheEntries) map.delete(map.keys().next().value); };
  /** One bounded exchange. Resolves {status, location, retryAfter, json} or throws PortabilityUnavailable. */
  async function request(url, { method = 'GET', body, maxBytes }) {
    const u = portabilityURL(url); if (!u) fault('invalid_url', 'The identity provider URL is not allowed.', 400);
    // Budgets come before any egress (client-metadata policy), so a refused lookup cannot amplify fetches.
    if (!await budgets.consume('portability/global', limits.global) || !await budgets.consume(`portability/site/${clientSite(u.hostname)}`, limits.perSite)) unavailable(60);
    const controller = new AbortController(); let timer;
    const work = (async () => {
      let response;
      try { response = await fetch(u.href, { method, headers: { Accept: JSON_TYPES.join(', '), ...body === undefined ? {} : { 'Content-Type': 'application/json' } }, ...body === undefined ? {} : { body }, redirect: 'manual', credentials: 'omit', signal: controller.signal }); }
      catch { unavailable(); }
      const status = response?.status;
      if (!Number.isInteger(status)) unavailable();
      const retry = Number(response.headers?.get?.('Retry-After')), retryAfter = Number.isSafeInteger(retry) && retry >= 0 ? Math.min(retry, 86400) : null;
      if (status === 429 || status >= 500) { await response.body?.cancel?.().catch(() => {}); unavailable(retryAfter); }
      const location = status >= 300 && status < 400 ? response.headers?.get?.('Location') ?? null : null;
      const type = (response.headers?.get?.('Content-Type') ?? '').split(';')[0].trim().toLowerCase(), encoding = response.headers?.get?.('Content-Encoding');
      let json = null, invalid = false, size = 0;
      if (JSON_TYPES.includes(type) && (!encoding || encoding.toLowerCase() === 'identity')) {
        const bytes = await boundedBytes(response, maxBytes, controller.signal);
        if (bytes === null) invalid = true;
        else if (bytes.byteLength) { size = bytes.byteLength; try { json = strictJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid = true; } }
      } else await response.body?.cancel?.().catch(() => {});
      return { status, location: typeof location === 'string' && location.length <= 4096 ? location : null, retryAfter, json, invalid, size };
    })();
    work.catch(() => {});
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PortabilityUnavailable()); }, limits.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  const client = {
    limits,
    /** Protocol §2 floor plus `directory.v1` and `portability.v1` members (spec §3). Invalid feature members make the
     * feature absent. Resolves {status:'ok', issuer, directory, portability} or {status:'gone'}. */
    async manifest(origin) {
      if (!httpsOrigin(origin)) fault('invalid_url', 'The identity provider URL is not allowed.', 400);
      const cached = manifests.get(origin); if (cached && cached.until > clock()) return cached.value;
      const response = await request(`${origin}${MANIFEST_PATH}`, { maxBytes: limits.manifestBytes });
      let value;
      if (response.status === 404 || response.status === 410) value = { status: 'gone' };
      else if (response.status !== 200 || response.invalid || !plainObject(response.json)) value = { status: 'invalid' };
      else {
        const document = response.json, features = plainObject(document.features) ? document.features : {};
        if (document.issuer !== origin || document.version !== '0') value = { status: 'invalid' };
        else {
          const dir = features['directory.v1'], directory = plainObject(dir) && onOrigin(dir.directory_url, origin) || null;
          const port = features['portability.v1'];
          let portability = null;
          if (directory && plainObject(port)) {
            const move = onOrigin(port.move_endpoint, origin), jwks = onOrigin(port.attestation_jwks_uri, origin), transferIn = port.transfer_in_endpoint === undefined ? undefined : onOrigin(port.transfer_in_endpoint, origin);
            if (move && jwks && transferIn !== null) portability = { move_endpoint: move, attestation_jwks_uri: jwks, ...transferIn ? { transfer_in_endpoint: transferIn } : {} };
            else if (port.move_endpoint === undefined && port.attestation_jwks_uri === undefined && transferIn) portability = { transfer_in_endpoint: transferIn };
          }
          value = { status: 'ok', issuer: origin, directory, portability };
        }
      }
      remember(manifests, origin, { value, until: clock() + (value.status === 'ok' ? limits.manifestTtl : MINUTE) });
      return value;
    },
    /** Directory `?sub=` (organizations §3a.2). {status:'found', identity} | {status:'moved', location, record|null} |
     * {status:'redirect', location} | {status:'gone'} | {status:'invalid'} | {status:'no-directory'}. */
    async lookup(origin, sub) {
      if (!isUUID(sub)) fault('invalid_request', 'Invalid identity.', 400);
      const manifest = await client.manifest(origin);
      if (manifest.status !== 'ok' || !manifest.directory) return { status: 'no-directory' };
      const response = await request(`${manifest.directory}?sub=${sub}`, { maxBytes: limits.directoryBytes });
      if (response.status === 200) { const body = response.json; return !response.invalid && exactMembers(body, ['iss', 'sub', 'identity']) && body.iss === origin && body.sub === sub && identityOn(body.identity, origin) ? { status: 'found', identity: body.identity } : { status: 'invalid' }; }
      if (response.status === 308) return { status: 'moved', location: response.location, record: movedBody(response.json, origin, sub) };
      if (response.status >= 300 && response.status < 400) return { status: 'redirect', location: response.location };
      if (response.status === 404 || response.status === 410) return { status: 'gone' };
      return { status: 'invalid' };
    },
    /** `<identity URI>/identity.json` (organizations §3a.3, with `moves`). {status:'ok', document} | {status:'moved',
     * location, record|null} | {status:'redirect', location} | {status:'gone'} | {status:'invalid'}. */
    async document(identity, { sub } = {}) {
      const url = portabilityURL(identity); if (!url || url.search) fault('invalid_url', 'The identity URI is not allowed.', 400);
      const response = await request(`${identity}/identity.json`, { maxBytes: limits.documentBytes });
      if (response.status === 200) return !response.invalid && validDocument(response.json, url.origin, sub, response.size) ? { status: 'ok', document: response.json } : { status: 'invalid' };
      if (response.status === 308) return { status: 'moved', location: response.location, record: movedBody(response.json, url.origin, sub) };
      if (response.status >= 300 && response.status < 400) return { status: 'redirect', location: response.location };
      if (response.status === 404 || response.status === 410) return { status: 'gone' };
      return { status: 'invalid' };
    },
    /** The issuer's attestation JWKS. `maxAge` bounds the cache (spec §5.1: one hour before an automatic adoption).
     * Resolves {jwks, fetchedAt} or {status:'absent'} when the issuer declares no attestation keys. */
    async attestationKeys(origin, { maxAge = limits.jwksFresh } = {}) {
      const cached = jwksCache.get(origin); if (cached && clock() - cached.fetchedAt <= maxAge) return cached;
      const manifest = await client.manifest(origin);
      if (manifest.status !== 'ok' || !manifest.portability?.attestation_jwks_uri) return { status: 'absent' };
      const response = await request(manifest.portability.attestation_jwks_uri, { maxBytes: limits.jwksBytes });
      if (response.status === 404 || response.status === 410) return { status: 'absent' };
      if (response.status !== 200 || response.invalid || !plainObject(response.json) || !Array.isArray(response.json.keys)) return { status: 'invalid' };
      const value = { jwks: response.json, fetchedAt: clock() }; remember(jwksCache, origin, value); return value;
    },
    /** The cached JWKS whatever its age (verifying records already adopted, or an issuer that is gone). */
    cachedAttestationKeys(origin) { return jwksCache.get(origin) ?? null; },
    /** POST to the source's move endpoint (spec §5.2). {status:'attested', attestation, redirect_until} |
     * {status:'pending', authorize_url, retry_after} | {status:'refused'} | {status:'unsupported'}; throws unavailable. */
    async move(origin, body) {
      const manifest = await client.manifest(origin);
      if (manifest.status !== 'ok' || !manifest.portability?.move_endpoint) return { status: 'unsupported' };
      const response = await request(manifest.portability.move_endpoint, { method: 'POST', body: JSON.stringify(body), maxBytes: limits.moveBytes });
      const json = response.json;
      if (response.status === 200 && exactMembers(json, ['status', 'attestation', 'redirect_until']) && json.status === 'attested' && typeof json.attestation === 'string' && (json.redirect_until === null || time(json.redirect_until))) return { status: 'attested', attestation: json.attestation, redirect_until: json.redirect_until };
      if (response.status === 202 && exactMembers(json, ['status', 'authorize_url', 'retry_after']) && json.status === 'pending' && Number.isSafeInteger(json.retry_after) && json.retry_after >= 0) return { status: 'pending', authorize_url: authorizeOn(json.authorize_url, origin), retry_after: json.retry_after };
      if (response.status === 409) return { status: 'refused' };
      if (response.status === 404 || response.status === 405 || response.status === 501) return { status: 'unsupported' };
      unavailable(response.retryAfter);
    },
  };
  return Object.freeze(client);
}
function movedBody(json, origin, sub) {
  if (!exactMembers(json, ['v', 'iss', 'sub', 'moved']) || json.v !== 1 || json.iss !== origin || json.sub !== sub || !exactMembers(json.moved, ['statement', 'attestation'])) return null;
  const { statement, attestation } = json.moved;
  return typeof statement === 'string' && (attestation === null || typeof attestation === 'string') ? { statement, attestation } : null;
}
/** Organizations §3a.3 with spec §7: `size` is the received byte count. A document with `moves` is within the §7 budget
 * (the fetch bound) and its records within the per-record caps; one without `moves` is at most DOCUMENT_BYTES (32 KiB). */
function validDocument(document, origin, sub, size = 0) {
  if (!plainObject(document) || document.v !== 1 || document.iss !== origin || (sub !== undefined && document.sub !== sub) || !isUUID(document.sub) || !['person', 'organization'].includes(document.kind ?? 'person')) return false;
  if (!Array.isArray(document.keys) || document.keys.length === 0 || document.keys.length > MAX_DOCUMENT_KEYS) return false;
  if (document.moves === undefined) return size <= DOCUMENT_BYTES;
  if (!Array.isArray(document.moves) || document.moves.length === 0 || document.moves.length > MAX_MOVES || document.moves.some(record => !exactMembers(record, ['statement', 'attestation']) || typeof record.statement !== 'string' || record.statement.length > MAX_STATEMENT_BYTES || !(record.attestation === null || typeof record.attestation === 'string' && record.attestation.length <= MAX_ATTESTATION_BYTES))) return false;
  return size <= MAX_MOVES_DOCUMENT_BYTES;
}
/** Signing keys of an identity document in the PORT-1 shape (`use:"sig"` only; certification and encryption keys are
 * separate purposes and never sign statements). */
export const signingKeysOf = document => (document?.keys ?? []).filter(entry => plainObject(entry) && (entry.use === undefined || entry.use === 'sig'));

/** Adapter egress for the portability client (Workers: strictly public routing plus a DoH screen; Node: a screened
 * resolver). Every A/AAAA answer must be globally routable. Screening is not connection pinning: Workers rely on
 * `global_fetch_strictly_public`, as client-id-metadata.v1 records. */
export function createPortabilityFetch({ fetcher = globalThis.fetch, resolve, publicRouting = false } = {}) {
  if (typeof fetcher !== 'function' || typeof resolve !== 'function' || publicRouting !== true) throw new TypeError('Portability egress needs a fetcher, an address screen and strictly public routing.');
  return async function portabilityFetch(value, init = {}) {
    const url = portabilityURL(value); if (!url) throw Object.assign(new Error('The identity provider could not be reached safely.'), { code: 'egress_refused' });
    const addresses = await resolve(url.hostname, { signal: init.signal });
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || addresses.some(address => !publicAddress(address))) throw Object.assign(new Error('The identity provider could not be reached safely.'), { code: 'egress_refused' });
    return fetcher(url.href, { method: init.method === 'POST' ? 'POST' : 'GET', headers: { ...init.headers, 'Accept-Encoding': 'identity' }, ...init.method === 'POST' ? { body: init.body } : {}, redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: init.signal });
  };
}

// ---- attestation-key pins (spec §5.1, P16) ------------------------------------------------------------------------

const APIN = issuer => key('attestation-pin', issuer);
/** Per-issuer attestation-key pins over a store. `check` verifies one attestation over one parsed statement. */
export function attestationPins({ store, client, roots = {}, clock = () => Date.now(), log = () => {}, crypto = globalThis.crypto }) {
  if (!store?.transaction) throw new TypeError('Attestation pins need a store.');
  async function evaluate(issuer, jwks) {
    const pin = await store.transaction(tx => tx.get(APIN(issuer)));
    const evaluated = await evaluateAttestationKeys({ issuer, jwks, pins: pin ? { [issuer]: { thumbprints: pin.thumbprints, firstUse: pin.firstUse } } : {}, roots }, { crypto });
    await store.transaction(async tx => {
      const current = await tx.get(APIN(issuer)), now = clock();
      if (evaluated.reset) { await tx.set(APIN(issuer), { ...current ?? { thumbprints: [], firstUse: false, pinnedAt: null }, resets: [...(current?.resets ?? []), now].slice(-8) }); return; }
      const next = evaluated.pins[issuer];
      // Pins only grow (a removed key stays pinned; spec §5.1), and first use is recorded once.
      await tx.set(APIN(issuer), { thumbprints: [...new Set([...(current?.thumbprints ?? []), ...next.thumbprints])], firstUse: current ? current.firstUse : next.firstUse, pinnedAt: current?.pinnedAt ?? now, resets: current?.resets ?? [] });
    });
    if (evaluated.reset) log({ action: 'attestation-reset', issuer });
    return evaluated;
  }
  return Object.freeze({
    evaluate,
    read: issuer => store.transaction(tx => tx.get(APIN(issuer))),
    /** §8.3 item 3. `fresh` demands a JWKS fetched within the last hour while the issuer is reachable. Resolves
     * {ok:true, aep, firstUse, kid, thumbprint} or {ok:false, reason}; throws PortabilityUnavailable. */
    async check(issuer, attestationJws, statement, { fresh = true } = {}) {
      let attestation; try { attestation = parseMoveAttestation(attestationJws); } catch { return { ok: false, reason: 'attestation-invalid' }; }
      let keys = fresh ? await client.attestationKeys(issuer) : client.cachedAttestationKeys(issuer) ?? await client.attestationKeys(issuer, { maxAge: Infinity });
      if (!keys?.jwks) return { ok: false, reason: keys?.status === 'absent' ? 'attestation-unavailable-keys' : 'attestation-invalid' };
      let evaluated; try { evaluated = await evaluate(issuer, keys.jwks); } catch { return { ok: false, reason: 'attestation-invalid' }; }
      if (evaluated.reset) return { ok: false, reason: 'attestation-reset' };
      // A kid absent from a successful (fresh) fetch is revoked (IP-R1-M3).
      const listed = keys.jwks.keys.find(entry => entry?.kid === attestation.header.kid);
      if (!listed) return { ok: false, reason: 'attestation-revoked' };
      const thumbprint = await attestationKeyThumbprint(listed, { crypto }).catch(() => null);
      if (!thumbprint || !evaluated.trusted.includes(thumbprint)) return { ok: false, reason: 'attestation-untrusted' };
      try { await verifyMoveAttestation(attestationJws, { statement, publicJwk: listed }, { crypto }); } catch { return { ok: false, reason: 'attestation-invalid' }; }
      return { ok: true, aep: attestation.payload.aep, firstUse: evaluated.firstUse, kid: listed.kid, thumbprint };
    },
  });
}

// ---- the registry -------------------------------------------------------------------------------------------------

const PIN = (iss, sub) => key('successor', iss, sub), INDEX = (iss, sub) => key('successor-index', iss, sub);
const PENDING = (iss, sub, digest) => key('successor-pending', iss, sub, digest), PENDING_OF = (iss, sub) => key('successor-pending', iss, sub);
const SOURCE = (iss, sub) => key('successor-source', iss, sub), QUEUE = id => key('successor-queue', id);
const PENDING_REASONS = new Set(['unattested', 'attestation-reset', 'attestation-untrusted', 'attestation-revoked', 'attestation-invalid', 'attestation-unavailable-keys', 'source-active', 'source-mismatch']);
const samePlace = (a, b) => a?.iss === b?.iss && a?.identity === b?.identity;
const originKey = origin => `${origin.iss}\n${origin.sub}`;
const result = (outcome, extra = {}) => ({ outcome, ...extra });

export class SuccessorRegistry {
  #serial = new Map();
  /** `store`: transactional store. `client`: portabilityClient. `enabled()`: the adoption flag. `roots`: issuer → root
   * thumbprints (attestationRoots). `log`: operator alerts (attestation resets, equivocation, contests). */
  constructor({ store, client, enabled = () => false, roots = {}, clock = () => Date.now(), random = { uuid: () => crypto.randomUUID() }, log = () => {}, crypto: webCrypto = globalThis.crypto }) {
    if (!store?.transaction || !client || typeof enabled !== 'function') throw new TypeError('Successor registry dependencies are required.');
    Object.assign(this, { store, client, enabled, clock, random, log, crypto: webCrypto });
    this.pins = attestationPins({ store, client, roots, clock, log, crypto: webCrypto });
  }
  on() { try { return this.enabled() === true; } catch { return false; } }
  serial(origin, work) { const name = originKey(origin), tail = this.#serial.get(name) ?? Promise.resolve(); const run = tail.then(work, work); const settled = run.catch(() => {}); this.#serial.set(name, settled); settled.then(() => { if (this.#serial.get(name) === settled) this.#serial.delete(name); }); return run; }
  pin(origin) { return this.store.transaction(tx => tx.get(PIN(origin.iss, origin.sub))); }
  /** Pins `issuer`'s attestation keys now, while the relationship is known to be genuine (best effort). P16 pins on
   * first use; doing it when a relationship starts (track) and whenever the identity arrives at a new host (adoption)
   * means a later lapse of that host is an attestation reset for this verifier instead of a first use. */
  async pinIssuer(issuer) {
    try { const keys = await this.client.attestationKeys(issuer); if (keys?.jwks) await this.pins.evaluate(issuer, keys.jwks); return true; }
    catch { return false; }
  }

  /** Registers a relationship with an identity that has not moved (or whose origin principal is known): the baseline
   * pin a verifier holds after its first directory verification (organizations §3a.4). Idempotent. It also pins the
   * host's attestation keys (a best-effort fetch), so call it from background work, never on a request path. */
  async track({ origin, kind = 'person', identity, signing, aep = 0 }) {
    if (!httpsOrigin(origin?.iss) || !isUUID(origin?.sub) || !identityOn(identity, origin.iss) || typeof signing?.kid !== 'string' || !plainObject(signing.publicJwk) || !['person', 'organization'].includes(kind) || !time(aep)) fault('invalid_request', 'Invalid successor pin.');
    return this.store.transaction(async tx => {
      const existing = await tx.get(PIN(origin.iss, origin.sub)); if (existing) return existing;
      const mapped = await tx.get(INDEX(origin.iss, origin.sub)); if (mapped && originKey(mapped.origin) !== originKey(origin)) fault('identity_contested', 'This identity is contested.', 409);
      const pin = { v: 1, origin: { iss: origin.iss, sub: origin.sub }, kind, current: { iss: origin.iss, identity }, head: { seq: 0, digest: null }, chain: [], signing: { kid: signing.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: signing.publicJwk.x, y: signing.publicJwk.y } }, seen: { retired: [], revoked: [], superseded: [] }, aep, status: 'ok', authorityHeld: false, attestationFirstUse: false, unattested: false, createdAt: this.clock(), revision: 1 };
      await tx.set(PIN(origin.iss, origin.sub), pin); return pin;
    }).then(async pin => { await this.pinIssuer(pin.current.iss); return pin; });
  }

  /** §8.1: the origin principal for an artifact's `(iss, sub)`. {origin, current, status, authorityHeld, accepts} where
   * `accepts` is whether certificates and fresh signatures under `iss` verify (only the pinned current host; an
   * earlier host fails). Null for an identity the verifier does not know. */
  async resolve({ iss, sub }) {
    if (!httpsOrigin(iss) || !isUUID(sub)) return null;
    return this.store.transaction(async tx => {
      let pin = await tx.get(PIN(iss, sub));
      if (!pin && this.on()) { const mapped = await tx.get(INDEX(iss, sub)); if (mapped) pin = await tx.get(PIN(mapped.origin.iss, mapped.origin.sub)); }
      if (!pin) return null;
      const moved = pin.head.seq > 0;
      return { origin: { ...pin.origin }, current: { ...pin.current }, status: pin.status, authorityHeld: pin.authorityHeld === true, unattested: pin.unattested === true, accepts: pin.status === 'ok' && pin.current.iss === iss && (!moved || this.on()), aep: pin.aep };
    });
  }

  // ---- verification primitives ----

  /** §8.3 item 4: the destination's directory names `to.identity`, and its document is well formed. */
  async destination(to, sub) {
    const found = await this.client.lookup(to.iss, sub);
    if (found.status === 'no-directory') return { fail: 'destination-no-directory' };
    if (found.status === 'moved' || found.status === 'redirect') return { fail: 'destination-moved', hint: found };
    if (found.status !== 'found' || found.identity !== to.identity) return { fail: 'destination-directory-mismatch' };
    const doc = await this.client.document(to.identity, { sub });
    if (doc.status !== 'ok' || doc.document.iss !== to.iss || doc.document.sub !== sub) return { fail: 'destination-document-invalid' };
    let lineage; try { lineage = await documentLineage(signingKeysOf(doc.document), sub); } catch { return { fail: 'destination-keys-invalid' }; }
    return { document: doc.document, lineage };
  }
  /** §8.3 item 5 with the 7-day rule. 'ok' | 'active' | 'mismatch'; throws PortabilityUnavailable inside 7 days. */
  async letGo(record, sub, later = []) {
    const source = record.parsed.payload.from.iss; let found;
    try { found = await this.client.lookup(source, sub); }
    catch (error) {
      if (!(error instanceof PortabilityUnavailable)) throw error;
      const now = this.clock(), since = await this.store.transaction(async tx => { const row = await tx.get(SOURCE(source, sub)); if (row) return row.since; await tx.set(SOURCE(source, sub), { since: now }); return now; });
      if (now - since >= this.client.limits.sourceGone) return 'ok';
      throw error;
    }
    if (found.status === 'no-directory') {
      // A reachable host without a directory is not "serving the identity"; it is treated like an unreachable one.
      const now = this.clock(), since = await this.store.transaction(async tx => { const row = await tx.get(SOURCE(source, sub)); if (row) return row.since; await tx.set(SOURCE(source, sub), { since: now }); return now; });
      if (now - since >= this.client.limits.sourceGone) return 'ok';
      unavailable();
    }
    await this.store.transaction(tx => tx.delete(SOURCE(source, sub)));
    // A host serving the identity under a different identity URI is a later incarnation (a return, spec §4) that has
    // let go of `from.identity` ONLY when a later record of the chain being verified moves the identity back there
    // (wargame F6). Any other URI is unexplained: a fabricated `from.identity` on a source that still serves the
    // identity must not pass as "let go". Serving `from.identity` itself means the move did not commit there.
    if (found.status === 'found') {
      if (found.identity === record.parsed.payload.from.identity) return 'active';
      return later.some(next => next.parsed.payload.to.iss === source && next.parsed.payload.to.identity === found.identity) ? 'ok' : 'active';
    }
    if (found.status === 'invalid') return 'active';
    if (found.status === 'gone') return 'ok';
    if (found.status === 'moved') return !found.record || (found.record.statement === record.statement && found.record.attestation === record.attestation) ? 'ok' : 'mismatch';
    return 'mismatch';
  }
  /** Items 1–3 and 5 for `records` (parsed, in order) after `previous` (parsed statement or null) at host `current`,
   * against the destination `lineage`, from lineage position `floor`. Returns {ok:true, aep, firstUse} or
   * {ok:false, index, reason, verifiedItems12}. Throws PortabilityUnavailable. */
  async verifyRecords({ records, previous, current, lineage, floor, sub, kind }) {
    const index = new Map(lineage.map((entry, i) => [entry.kid, i])); let prev = previous, low = floor, aep = 0, firstUse = false;
    for (let i = 0; i < records.length; i++) {
      const record = records[i], s = record.parsed.payload;
      try { await verifyMoveRecordLink(prev, record.parsed, { crypto: this.crypto }); } catch { return { ok: false, index: i, reason: 'chain-link' }; }
      if (prev === null && !samePlace(s.from, current)) return { ok: false, index: i, reason: 'chain-link' };
      if (s.sub !== sub || (kind && s.kind !== kind)) return { ok: false, index: i, reason: 'chain-link' };
      const position = index.get(record.parsed.header.kid);
      if (position === undefined || position < low) return { ok: false, index: i, reason: 'statement-key' };
      try { await verifyMoveStatement(record.parsed.value, lineage[position].publicJwk, { crypto: this.crypto }); } catch { return { ok: false, index: i, reason: 'statement-invalid' }; }
      low = position;
      if (record.attestation === null) return { ok: false, index: i, reason: 'unattested', verifiedItems12: true };
      const checked = await this.pins.check(s.from.iss, record.attestation, record.parsed, { fresh: true });
      if (!checked.ok) return { ok: false, index: i, reason: checked.reason, verifiedItems12: true };
      const released = await this.letGo(record, sub, records.slice(i + 1));
      if (released !== 'ok') return { ok: false, index: i, reason: released === 'active' ? 'source-active' : 'source-mismatch', verifiedItems12: true };
      aep = checked.aep; firstUse ||= checked.firstUse; prev = record.parsed;
    }
    return { ok: true, aep, firstUse };
  }
  /** No-rollback (organizations §3a.4) and "equal to or continuity-linked from the pinned key" (§8.3 item 4). */
  keyFloor(pin, document, lineage) {
    const keys = signingKeysOf(document), seen = new Set([...pin.seen.retired, ...pin.seen.revoked, ...pin.seen.superseded]);
    if (keys.some(entry => entry.state === 'active' && seen.has(entry.kid))) return { fail: 'key-rollback' };
    const position = lineage.findIndex(entry => entry.kid === pin.signing.kid);
    if (position < 0) return { fail: 'pinned-key-unlinked' };
    const pinned = lineage[position].publicJwk;
    if (pinned.x !== pin.signing.publicJwk.x || pinned.y !== pin.signing.publicJwk.y) return { fail: 'pinned-key-unlinked' };
    return { floor: position };
  }
  /** The pinned host's state (§8.5, IP-R1-M7), two separate facts (wargame F7): `serving`, whether its directory names
   * the pinned identity URI and its document lists the pinned key as active, whatever its manifest declares; and
   * `portability`, whether it declares portability.v1 (a move endpoint), so that a real move would carry its
   * attestation. Throws PortabilityUnavailable. */
  async hostState(pin) {
    const manifest = await this.client.manifest(pin.current.iss);
    const portability = Boolean(manifest.status === 'ok' && manifest.portability?.move_endpoint);
    if (manifest.status !== 'ok' || !manifest.directory) return { serving: false, portability };
    const found = await this.client.lookup(pin.current.iss, pin.origin.sub);
    if (found.status !== 'found' || found.identity !== pin.current.identity) return { serving: false, portability };
    const doc = await this.client.document(pin.current.identity, { sub: pin.origin.sub });
    if (doc.status !== 'ok') return { serving: false, portability };
    return { serving: signingKeysOf(doc.document).some(entry => entry.state === 'active' && entry.kid === pin.signing.kid), portability };
  }
  parse(records) {
    if (!Array.isArray(records) || records.length === 0 || records.length > MAX_MOVES) return null;
    try { return records.map(record => { if (!exactMembers(record, ['statement', 'attestation']) || !(record.attestation === null || typeof record.attestation === 'string')) throw new Error('record'); return { statement: record.statement, attestation: record.attestation, parsed: parseMoveStatement(record.statement) }; }); } catch { return null; }
  }
  async digest(record) { return statementDigest(record.parsed.input, { crypto: this.crypto }); }

  // ---- adoption (§8.3, §8.4) ----

  /** Applies `moves` (any records of the identity's chain, in any order) to the pin of `origin`: replays are ignored,
   * differing attested records at or below the pin are equivocation, and records above the head are adopted in `seq`
   * order when every check passes. Background only (it fetches). */
  async adopt(origin, moves) {
    if (!this.on()) return result('disabled');
    return this.serial(origin, () => this.adoptOnce(origin, moves));
  }
  async adoptOnce(origin, moves, attempt = 0) {
    const pin = await this.pin(origin);
    if (!pin) return result('unknown');
    if (pin.status === 'contested') return result('contested', { origin: pin.origin });
    const records = this.parse(moves); if (!records) return result('refused', { reason: 'malformed' });
    if (records.some(record => record.parsed.payload.sub !== origin.sub)) return result('refused', { reason: 'subject' });
    try {
      // §8.4: at or below the pin.
      for (const record of records.filter(r => r.parsed.payload.seq <= pin.head.seq)) {
        const known = pin.chain[record.parsed.payload.seq - 1];
        if (known && known.statement === record.statement && known.attestation === record.attestation) continue;
        if (record.attestation !== null && known && await this.equivocates(record, known)) return await this.contest(origin, 'equivocation', { seq: record.parsed.payload.seq });
      }
      const ahead = records.filter(r => r.parsed.payload.seq > pin.head.seq).sort((a, b) => a.parsed.payload.seq - b.parsed.payload.seq);
      // Two different records for the same position above the head, both attested and valid, are equivocation too.
      for (let i = 1; i < ahead.length; i++) if (ahead[i].parsed.payload.seq === ahead[i - 1].parsed.payload.seq && ahead[i].statement !== ahead[i - 1].statement && ahead[i].attestation && ahead[i - 1].attestation && await this.equivocates(ahead[i], ahead[i - 1])) return await this.contest(origin, 'equivocation', { seq: ahead[i].parsed.payload.seq });
      const next = ahead.filter((r, i) => i === 0 || r.parsed.payload.seq !== ahead[i - 1].parsed.payload.seq);
      if (!next.length) return result('replay', { origin: pin.origin });
      if (next.some((r, i) => r.parsed.payload.seq !== pin.head.seq + 1 + i)) return result('refused', { reason: 'gap' });
      const last = next.at(-1), to = last.parsed.payload.to, dest = await this.destination(to, origin.sub);
      if (dest.fail) return result('refused', { reason: dest.fail, ...dest.hint ? { hint: dest.hint } : {} });
      // The destination's `moves` carries every applied record byte for byte and ends with the last one.
      const docMoves = dest.document.moves ?? [];
      if (docMoves.length !== last.parsed.payload.seq || next.some(r => { const at = docMoves[r.parsed.payload.seq - 1]; return at?.statement !== r.statement || at.attestation !== r.attestation; })) return result('refused', { reason: 'destination-moves-mismatch' });
      const floor = this.keyFloor(pin, dest.document, dest.lineage); if (floor.fail) return result('refused', { reason: floor.fail });
      const previous = pin.chain.length ? parseMoveStatement(pin.chain.at(-1).statement) : null;
      const verified = await this.verifyRecords({ records: next, previous, current: pin.current, lineage: dest.lineage, floor: floor.floor, sub: origin.sub, kind: pin.kind });
      if (!verified.ok) {
        const failing = next[verified.index];
        if (verified.verifiedItems12 && PENDING_REASONS.has(verified.reason)) return await this.offer(pin, failing, verified.reason);
        return result('refused', { reason: verified.reason });
      }
      return await this.commit(pin, next, dest, { aep: verified.aep, firstUse: verified.firstUse, unattested: false });
    } catch (error) {
      if (error?.code === 'stale' && attempt < 3) return this.adoptOnce(origin, moves, attempt + 1);
      if (error instanceof PortabilityUnavailable) return result('unavailable', { retryAfter: error.retryAfter ?? null });
      throw error;
    }
  }
  /** A differing record with a valid attestation from the same source (§8.4, IP-R1-M6). */
  async equivocates(record, known) {
    const k = parseMoveStatement(known.statement);
    if (record.parsed.payload.from.iss !== k.payload.from.iss) return false;
    try { const checked = await this.pins.check(record.parsed.payload.from.iss, record.attestation, record.parsed, { fresh: false }); return checked.ok; }
    catch (error) { if (error instanceof PortabilityUnavailable) throw error; return false; }
  }
  async contest(origin, reason, detail = {}) {
    const pin = await this.store.transaction(async tx => { const current = await tx.get(PIN(origin.iss, origin.sub)); if (!current) return null; if (current.status !== 'contested') { current.status = 'contested'; current.contested = { reason, at: this.clock(), ...detail }; current.revision++; await tx.set(PIN(origin.iss, origin.sub), current); } return current; });
    this.log({ action: 'successor-contested', origin, reason });
    return result('contested', { origin: pin?.origin ?? origin, reason });
  }
  /** The adoption commit (§8.3, last paragraph): pin, index, certification-key switch (by `current`), aep floor and the
   * authority reset, atomically. Index conflicts (IP-R1-M5) contest both identities instead. */
  async commit(pin, records, dest, { aep, firstUse, unattested }) {
    const origin = pin.origin, digests = await Promise.all(records.map(record => this.digest(record)));
    const conflict = await this.store.transaction(async tx => {
      for (const record of records) {
        const to = record.parsed.payload.to, other = await tx.get(PIN(to.iss, origin.sub)), mapped = await tx.get(INDEX(to.iss, origin.sub));
        if (other && originKey(other.origin) !== originKey(origin)) return other.origin;
        if (mapped && originKey(mapped.origin) !== originKey(origin)) return mapped.origin;
      }
      const current = await tx.get(PIN(origin.iss, origin.sub));
      if (!current || current.revision !== pin.revision) throw Object.assign(new Error('stale pin'), { code: 'stale' });
      // The signing pin is the key that speaks for the identity at its new current host: the active key when the
      // destination document ends with the last committed record, otherwise the key that signed the next record (a
      // confirmed pending successor whose destination has since moved on), so the remaining records stay above it.
      const keys = signingKeysOf(dest.document), last = records.at(-1).parsed.payload, following = dest.document.moves?.[last.seq];
      let anchorAt = dest.lineage.length - 1;
      if (following) { try { const kid = parseMoveStatement(following.statement).header.kid, at = dest.lineage.findIndex(entry => entry.kid === kid); if (at >= 0) anchorAt = at; } catch {} }
      const active = dest.lineage[anchorAt];
      const next = { ...current, current: { iss: last.to.iss, identity: last.to.identity }, head: { seq: last.seq, digest: digests.at(-1) },
        chain: [...current.chain, ...records.map(record => ({ statement: record.statement, attestation: record.attestation }))].slice(0, MAX_MOVES),
        signing: { kid: active.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: active.publicJwk.x, y: active.publicJwk.y } },
        seen: { retired: [...new Set([...current.seen.retired, ...keys.filter(entry => entry.state === 'retired' && !dest.lineage.slice(anchorAt).some(later => later.kid === entry.kid)).map(entry => entry.kid)])].slice(-64), revoked: [...new Set([...current.seen.revoked, ...keys.filter(entry => entry.state === 'revoked').map(entry => entry.kid)])].slice(-64), superseded: [...new Set([...current.seen.superseded, ...dest.lineage.slice(0, anchorAt).map(entry => entry.kid)])].slice(-64) },
        aep: Math.max(current.aep, aep), authorityHeld: true, attestationFirstUse: current.attestationFirstUse || firstUse, unattested: current.unattested || unattested, adoptedAt: this.clock(), revision: current.revision + 1 };
      await tx.set(PIN(origin.iss, origin.sub), next);
      for (const record of records) { const to = record.parsed.payload.to; await tx.set(INDEX(to.iss, origin.sub), { origin: { ...origin } }); }
      for (const { key: path, value } of await tx.list(PENDING_OF(origin.iss, origin.sub))) if (value?.seq <= last.seq) await tx.delete(path);
      return null;
    });
    if (conflict) { await this.contest(conflict, 'index-conflict'); return this.contest(origin, 'index-conflict'); }
    this.log({ action: 'successor-adopted', origin, seq: records.at(-1).parsed.payload.seq, unattested });
    const pinNow = await this.pin(origin);
    await this.pinIssuer(pinNow.current.iss);
    return result('adopted', { origin: { ...origin }, current: { ...pinNow.current }, adopted: records.length, attestation_first_use: firstUse, authorityHeld: true });
  }

  // ---- pending successors (§8.5) ----

  async offer(pin, record, reason) {
    // The §8.3 item 4 directory check already passed for the final destination; it must pass for this record too.
    const to = record.parsed.payload.to, found = await this.client.lookup(to.iss, pin.origin.sub);
    if (found.status !== 'found' || found.identity !== to.identity) return result('refused', { reason });
    // A portability host that still serves the identity would have attested a real move: refused outright. A host
    // without portability that still serves it is offered with the warning (§8.5: the human confirms after it).
    const host = await this.hostState(pin);
    if (host.serving && host.portability) return result('refused', { reason, sourceActive: true });
    const digest = await this.digest(record), now = this.clock();
    await this.store.transaction(async tx => {
      const existing = await tx.list(PENDING_OF(pin.origin.iss, pin.origin.sub));
      if (existing.some(row => row.key === PENDING(pin.origin.iss, pin.origin.sub, digest))) return;
      if (existing.length >= PENDING_LIMIT) await tx.delete(existing.sort((a, b) => a.value.offeredAt - b.value.offeredAt)[0].key);
      await tx.set(PENDING(pin.origin.iss, pin.origin.sub, digest), { digest, seq: record.parsed.payload.seq, record: { statement: record.statement, attestation: record.attestation }, reason, from: record.parsed.payload.from, to, offeredAt: now, oldHostServing: host.serving, checkedAt: now });
    });
    this.log({ action: 'successor-pending', origin: pin.origin, reason });
    return result('pending', { origin: { ...pin.origin }, reason, digest, from: { ...record.parsed.payload.from }, to: { ...to }, oldProviderConfirmed: false, oldHostServing: host.serving });
  }
  /** What the human must be shown before adopting (§8.5): the old provider did not confirm the move, both hosts by
   * origin, and whether the old host still serves the identity as active (`oldHostServing`, as last checked at
   * `checkedAt`; confirm re-checks live and answers `confirmation-required` if it serves now). */
  async pending(origin) {
    const rows = await this.store.transaction(tx => tx.list(PENDING_OF(origin.iss, origin.sub)));
    return rows.map(({ value }) => ({ digest: value.digest, seq: value.seq, reason: value.reason, oldProviderConfirmed: false, oldHost: value.from.iss, newHost: value.to.iss, offeredAt: value.offeredAt, oldHostServing: value.oldHostServing === true, checkedAt: value.checkedAt ?? value.offeredAt }));
  }
  /** The explicit local act (§8.5): adopts a pending successor with the §8.3 effects, including the authority reset.
   * `acknowledgeSourceActive` is required when the pinned host still serves the identity as active. */
  async confirm(origin, { digest, acknowledgeSourceActive = false } = {}) {
    if (!this.on()) return result('disabled');
    return this.serial(origin, async () => {
      const pin = await this.pin(origin); if (!pin) return result('unknown');
      if (pin.status === 'contested') return result('contested', { origin: pin.origin });
      const row = await this.store.transaction(tx => tx.get(PENDING(origin.iss, origin.sub, digest)));
      if (!row) return result('refused', { reason: 'not-pending' });
      const records = this.parse([row.record]);
      const drop = () => this.store.transaction(tx => tx.delete(PENDING(origin.iss, origin.sub, digest)));
      if (!records || records[0].parsed.payload.seq !== pin.head.seq + 1) { await drop(); return result('refused', { reason: 'stale' }); }
      try {
        const record = records[0], dest = await this.destination(record.parsed.payload.to, origin.sub);
        if (dest.fail) return result('refused', { reason: dest.fail });
        const docMoves = dest.document.moves ?? [], at = docMoves[record.parsed.payload.seq - 1];
        if (!at || at.statement !== record.statement || at.attestation !== record.attestation) return result('refused', { reason: 'destination-moves-mismatch' });
        const floor = this.keyFloor(pin, dest.document, dest.lineage); if (floor.fail) return result('refused', { reason: floor.fail });
        // Items 1 and 2 again (the pin may have changed since the offer).
        const previous = pin.chain.length ? parseMoveStatement(pin.chain.at(-1).statement) : null;
        try { await verifyMoveRecordLink(previous, record.parsed, { crypto: this.crypto }); } catch { await drop(); return result('refused', { reason: 'stale' }); }
        if (previous === null && !samePlace(record.parsed.payload.from, pin.current)) { await drop(); return result('refused', { reason: 'stale' }); }
        const position = dest.lineage.findIndex(entry => entry.kid === record.parsed.header.kid);
        if (position < floor.floor) return result('refused', { reason: 'statement-key' });
        try { await verifyMoveStatement(record.parsed.value, dest.lineage[position].publicJwk, { crypto: this.crypto }); } catch { return result('refused', { reason: 'statement-invalid' }); }
        // §8.5: while the pinned host serves the identity as active with the pinned key (with or without portability),
        // only a confirmation given after the warning adopts. The row learns the fact so pending() shows the warning.
        if ((await this.hostState(pin)).serving && acknowledgeSourceActive !== true) {
          await this.store.transaction(async tx => { const live = await tx.get(PENDING(origin.iss, origin.sub, digest)); if (live) await tx.set(PENDING(origin.iss, origin.sub, digest), { ...live, oldHostServing: true, checkedAt: this.clock() }); });
          return result('confirmation-required', { reason: 'source-active', oldHost: pin.current.iss, newHost: record.parsed.payload.to.iss });
        }
        // A dest document that ends later than this record: the commit records only this record.
        const partial = { document: { ...dest.document }, lineage: dest.lineage };
        const committed = await this.commit(pin, [record], partial, { aep: 0, firstUse: false, unattested: true });
        if (committed.outcome === 'adopted') this.log({ action: 'successor-confirmed', origin, reason: row.reason });
        return committed;
      } catch (error) {
        if (error?.code === 'stale') return result('refused', { reason: 'stale' });
        if (error instanceof PortabilityUnavailable) return result('unavailable', { retryAfter: error.retryAfter ?? null });
        throw error;
      }
    });
  }
  async dismiss(origin, { digest } = {}) { await this.store.transaction(tx => tx.delete(PENDING(origin.iss, origin.sub, digest))); return result('dismissed'); }

  // ---- first contact (§8.6) ----

  /** Meets `(iss, sub)` for the first time at its current host. `purpose`: 'relationship' (the caller holds a
   * relationship keyed by the claimed origin) or 'origin-linking' (an application linking an existing account);
   * otherwise the chain is not verified now (IP-R1-M8) and the identity is keyed by its current `(iss, sub)`. */
  async firstContact({ iss, sub, purpose = null }) {
    if (!httpsOrigin(iss) || !isUUID(sub)) fault('invalid_request', 'Invalid identity.');
    const known = await this.resolve({ iss, sub }); if (known) return result('known', known);
    const found = await this.client.lookup(iss, sub).catch(error => { if (error instanceof PortabilityUnavailable) return { status: 'unavailable' }; throw error; });
    if (found.status === 'unavailable') return result('unavailable');
    if (found.status !== 'found') return result('refused', { reason: 'directory' });
    const doc = await this.client.document(found.identity, { sub }).catch(error => { if (error instanceof PortabilityUnavailable) return { status: 'unavailable' }; throw error; });
    if (doc.status === 'unavailable') return result('unavailable');
    if (doc.status !== 'ok') return result('refused', { reason: 'document' });
    const document = doc.document, local = { origin: { iss, sub }, verified: false };
    let lineage; try { lineage = await documentLineage(signingKeysOf(document), sub); } catch { return result('refused', { reason: 'document' }); }
    if (!document.moves) return result('unmoved', { origin: { iss, sub }, identity: found.identity, signing: { kid: lineage.at(-1).kid, publicJwk: lineage.at(-1).publicJwk }, verified: true });
    if (!this.on()) return result('unverified', { ...local, reason: 'disabled' });
    const records = this.parse(document.moves); if (!records) return result('unverified', { ...local, reason: 'malformed' });
    const first = records[0].parsed.payload, claimed = { iss: first.from.iss, sub };
    // Offline checks first: linkage, continuity of from/to, the last `to`, and every statement signature.
    const offline = await this.offlineChain(records, lineage, { iss, identity: found.identity });
    if (!offline) return result('unverified', { ...local, claimedOrigin: claimed, reason: 'chain' });
    const relationship = await this.pin(claimed);
    if (relationship) { const adopted = await this.adopt(claimed, document.moves); return adopted.outcome === 'adopted' || adopted.outcome === 'replay' ? result('known', await this.resolve({ iss, sub })) : result('unverified', { ...local, claimedOrigin: claimed, reason: adopted.reason ?? adopted.outcome }); }
    if (purpose !== 'origin-linking') return result('unverified', { ...local, claimedOrigin: claimed, reason: 'deferred' });
    return this.serial(claimed, async () => {
      try {
        const verified = await this.verifyRecords({ records, previous: null, current: { iss: first.from.iss, identity: first.from.identity }, lineage, floor: 0, sub, kind: first.kind });
        if (!verified.ok) return result('unverified', { ...local, claimedOrigin: claimed, reason: verified.reason });
        const digests = await Promise.all(records.map(record => this.digest(record))), active = lineage.at(-1), keys = signingKeysOf(document);
        const created = await this.store.transaction(async tx => {
          if (await tx.get(PIN(claimed.iss, sub))) return { conflict: claimed };
          for (const record of records) { const to = record.parsed.payload.to, other = await tx.get(PIN(to.iss, sub)), mapped = await tx.get(INDEX(to.iss, sub)); if (other || mapped && originKey(mapped.origin) !== originKey(claimed)) return { conflict: other?.origin ?? mapped.origin }; }
          const pin = { v: 1, origin: claimed, kind: first.kind, current: { iss, identity: found.identity }, head: { seq: records.at(-1).parsed.payload.seq, digest: digests.at(-1) }, chain: records.map(record => ({ statement: record.statement, attestation: record.attestation })), signing: { kid: active.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: active.publicJwk.x, y: active.publicJwk.y } }, seen: { retired: keys.filter(entry => entry.state === 'retired').map(entry => entry.kid), revoked: keys.filter(entry => entry.state === 'revoked').map(entry => entry.kid), superseded: lineage.slice(0, -1).map(entry => entry.kid) }, aep: verified.aep, status: 'ok', authorityHeld: false, attestationFirstUse: verified.firstUse, unattested: false, createdAt: this.clock(), revision: 1 };
          await tx.set(PIN(claimed.iss, sub), pin);
          for (const record of records) { const to = record.parsed.payload.to; await tx.set(INDEX(to.iss, sub), { origin: claimed }); }
          return { pin };
        });
        if (created.conflict) { await this.contest(created.conflict, 'index-conflict'); return result('unverified', { ...local, claimedOrigin: claimed, reason: 'index-conflict' }); }
        await this.pinIssuer(iss);
        return result('verified', { origin: claimed, current: { iss, identity: found.identity }, verified: true, attestation_first_use: verified.firstUse });
      } catch (error) { if (error instanceof PortabilityUnavailable) return result('unverified', { ...local, claimedOrigin: claimed, reason: 'temporarily_unavailable' }); throw error; }
    });
  }
  async offlineChain(records, lineage, current) {
    const index = new Map(lineage.map((entry, i) => [entry.kid, i])); let prev = null, low = 0;
    for (const record of records) {
      try { await verifyMoveRecordLink(prev, record.parsed, { crypto: this.crypto }); } catch { return false; }
      const position = index.get(record.parsed.header.kid); if (position === undefined || position < low) return false;
      try { await verifyMoveStatement(record.parsed.value, lineage[position].publicJwk, { crypto: this.crypto }); } catch { return false; }
      low = position; prev = record.parsed;
    }
    return samePlace(prev.payload.to, current);
  }

  // ---- how verifiers learn of moves (§8.7) ----

  /** Background refresh of a pinned identity: the pinned identity document; a `308` moved body or `Location` is only a
   * hint, followed at most `maxHops` cross-origin times (cycles refused), and accepted only through adoption. */
  async refresh(origin) {
    if (!this.on()) return result('disabled');
    const pin = await this.pin(origin); if (!pin) return result('unknown');
    if (pin.status === 'contested') return result('contested', { origin: pin.origin });
    let response; try { response = await this.client.document(pin.current.identity, { sub: origin.sub }); } catch (error) { if (error instanceof PortabilityUnavailable) return result('unavailable'); throw error; }
    if (response.status === 'ok') return result('current', { origin: pin.origin });
    if (response.status === 'gone' || response.status === 'invalid') return result(response.status, { origin: pin.origin });
    const visited = new Set([pin.current.iss]);
    let hint = response;
    for (let hop = 0; hop < this.client.limits.maxHops; hop++) {
      // The moved body names the destination; a bare Location names at most an origin to ask (never a path to trust).
      let target = null;
      if (hint.record) { try { target = parseMoveStatement(hint.record.statement).payload.to.iss; } catch { target = null; } }
      if (!target && hint.location) { try { target = new URL(hint.location).origin; } catch { target = null; } }
      if (!target || !httpsOrigin(target) || visited.has(target)) return result('refused', { reason: target && visited.has(target) ? 'redirect-cycle' : 'hint' });
      visited.add(target);
      let found; try { found = await this.client.lookup(target, origin.sub); } catch (error) { if (error instanceof PortabilityUnavailable) return result('unavailable'); throw error; }
      if (found.status === 'moved' || found.status === 'redirect') { hint = found; continue; }
      if (found.status !== 'found') return result('refused', { reason: 'hint' });
      let doc; try { doc = await this.client.document(found.identity, { sub: origin.sub }); } catch (error) { if (error instanceof PortabilityUnavailable) return result('unavailable'); throw error; }
      if (doc.status === 'moved' || doc.status === 'redirect') { hint = doc; continue; }
      if (doc.status !== 'ok' || !doc.document.moves) return result('refused', { reason: 'hint' });
      return this.adopt(origin, doc.document.moves);
    }
    return result('refused', { reason: 'redirect-hops' });
  }
  /** Presentation intake (§8.7): structurally and offline checked, then queued for background verification; the
   * caller's request never fetches and always gets the same answer. Chains for identities the verifier does not pin,
   * and chains that fail the offline checks against the pin, are dropped (wargame F8). */
  async present({ moves } = {}) {
    if (!this.on()) return { accepted: true };
    const records = this.parse(moves); if (!records) return { accepted: true };
    const origin = { iss: records[0].parsed.payload.from.iss, sub: records[0].parsed.payload.sub };
    const pin = await this.pin(origin);
    const checked = pin ? await this.queueable(pin, records) : false;
    if (!checked) return { accepted: true };
    const verified = checked === 'verified';
    const id = `${origin.iss}|${origin.sub}|${await this.digest(records.at(-1))}`, now = this.clock();
    // Eviction order (review follow-up 2): rows not verified offline go before rows verified under the pinned key; the
    // most-tried, then oldest, row of that class goes first. Unverified rows are capped per origin, and a full queue
    // evicts from the origin holding the most rows instead of dropping the new row.
    const victim = list => [...list].sort((a, b) => Number(a.value.verified === true) - Number(b.value.verified === true) || (b.value.attempts ?? 0) - (a.value.attempts ?? 0) || (a.value.at ?? 0) - (b.value.at ?? 0))[0];
    await this.store.transaction(async tx => {
      let rows = await tx.list(key('successor-queue'));
      if (rows.some(row => row.value?.id === id)) return;
      const drop = async row => { await tx.delete(row.key); rows = rows.filter(other => other.key !== row.key); };
      const ofOrigin = name => rows.filter(row => row.value?.origin && originKey(row.value.origin) === name);
      const mine = () => ofOrigin(originKey(origin));
      if (!verified) { const unverified = mine().filter(row => row.value.verified !== true); if (unverified.length >= QUEUE_POLICY.perOriginUnverified) await drop(victim(unverified)); }
      if (mine().length >= QUEUE_POLICY.perOrigin) { const candidates = verified ? mine() : mine().filter(row => row.value.verified !== true); if (!candidates.length) return; await drop(victim(candidates)); }
      if (rows.length >= QUEUE_LIMIT) {
        const counts = new Map(); for (const row of rows) { const name = row.value?.origin ? originKey(row.value.origin) : ''; counts.set(name, (counts.get(name) ?? 0) + 1); }
        const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const pool = largest === '' ? rows.filter(row => !row.value?.origin) : ofOrigin(largest);
        const candidates = verified ? pool : pool.filter(row => row.value?.verified !== true);
        if (!candidates.length) return;
        await drop(victim(candidates));
      }
      await tx.set(QUEUE(this.random.uuid()), { id, origin, moves: records.map(record => ({ statement: record.statement, attestation: record.attestation })), at: now, nextAt: now, attempts: 0, verified });
    });
    return { accepted: true };
  }
  /** Offline checks before a presented chain may occupy the queue: one subject; records above the pin's head are
   * contiguous from it and link (`seq`/`prev`/`from` = previous `to`, the first from the pinned current place); a
   * record signed by the pinned key's `kid` must verify under it. A chain with nothing above the head is kept only
   * when it carries an attested record that differs from the pinned chain (possible equivocation evidence, §8.4).
   * Resolves false, 'verified' (the first record above the head verified under the pinned key) or 'unverified'. */
  async queueable(pin, records) {
    if (records.some(record => record.parsed.payload.sub !== pin.origin.sub)) return false;
    const sorted = [...records].sort((a, b) => a.parsed.payload.seq - b.parsed.payload.seq);
    const ahead = sorted.filter((record, i) => record.parsed.payload.seq > pin.head.seq && (i === 0 || record.parsed.payload.seq !== sorted[i - 1].parsed.payload.seq));
    if (!ahead.length) return sorted.some(record => record.attestation !== null && pin.chain[record.parsed.payload.seq - 1]?.statement !== record.statement) ? 'unverified' : false;
    let prev = pin.chain.length ? parseMoveStatement(pin.chain.at(-1).statement) : null, verified = false;
    for (const [i, record] of ahead.entries()) {
      try { await verifyMoveRecordLink(prev, record.parsed, { crypto: this.crypto }); } catch { return false; }
      if (prev === null && !samePlace(record.parsed.payload.from, pin.current)) return false;
      if (record.parsed.header.kid === pin.signing.kid) { try { await verifyMoveStatement(record.parsed.value, pin.signing.publicJwk, { crypto: this.crypto }); } catch { return false; } if (i === 0) verified = true; }
      prev = record.parsed;
    }
    return verified ? 'verified' : 'unverified';
  }
  /** One bounded background pass over presented chains: due rows in `nextAt` order, at most `perOriginPass` per origin.
   * An unavailable answer backs the row off; after `attempts` of them it is dropped (a later presentation or the
   * background refresh can bring the chain back). */
  async drain({ limit = 16 } = {}) {
    if (!this.on()) return { processed: 0 };
    const now = this.clock(), perOrigin = new Map(), rows = [];
    for (const row of (await this.store.transaction(tx => tx.list(key('successor-queue')))).filter(row => (row.value?.nextAt ?? row.value?.at ?? 0) <= now).sort((a, b) => (a.value.nextAt ?? a.value.at) - (b.value.nextAt ?? b.value.at))) {
      if (rows.length >= limit) break;
      const name = row.value?.origin ? originKey(row.value.origin) : '', count = perOrigin.get(name) ?? 0;
      if (count >= QUEUE_POLICY.perOriginPass) continue;
      perOrigin.set(name, count + 1); rows.push(row);
    }
    let processed = 0, dropped = 0;
    for (const { key: path, value } of rows) {
      const outcome = await this.adopt(value.origin, value.moves);
      const attempts = (value.attempts ?? 0) + 1;
      if (outcome.outcome !== 'unavailable' || attempts >= QUEUE_POLICY.attempts) {
        await this.store.transaction(tx => tx.delete(path));
        if (outcome.outcome === 'unavailable') { dropped++; this.log({ action: 'successor-queue-dropped', origin: value.origin, attempts }); }
      } else {
        const wait = Math.min(QUEUE_POLICY.max, QUEUE_POLICY.base * 2 ** (attempts - 1)), retry = (outcome.retryAfter ?? 0) * 1000;
        await this.store.transaction(async tx => { const live = await tx.get(path); if (live) await tx.set(path, { ...live, attempts, nextAt: this.clock() + Math.max(wait, Math.min(retry, QUEUE_POLICY.max)) }); });
      }
      processed++;
    }
    return { processed, dropped };
  }
}

// ---- engine operations ----------------------------------------------------------------------------------------
// Actors are built by trusted adapters: `system` (background jobs, the organizations and Parlay ports), `operator`
// (the human who owns the relationship confirms or dismisses pending successors) and `public` (presentation intake).
const CHANGED = 'successors-changed';
const ORIGIN = value => { if (!exactMembers(value, ['iss', 'sub']) || !httpsOrigin(value.iss) || !isUUID(value.sub)) fault('invalid_request', 'Name the identity by its origin principal.'); return { iss: value.iss, sub: value.sub }; };
const system = actor => { if (!['system', 'operator'].includes(actor?.kind)) fault('forbidden', 'Successor operations require a trusted actor.', 403); };
class SuccessorAction extends AppAction { static deps = ['successors']; static changes = CHANGED; }
export class TrackSuccessor extends SuccessorAction { static operation = 'successors.track'; run({ successors }) { system(this.actor); return successors.track({ ...this.input, origin: ORIGIN(this.input?.origin) }); } }
export class AdoptSuccessor extends SuccessorAction { static operation = 'successors.adopt'; run({ successors }) { system(this.actor); return successors.adopt(ORIGIN(this.input?.origin), this.input?.moves); } }
export class RefreshSuccessor extends SuccessorAction { static operation = 'successors.refresh'; run({ successors }) { system(this.actor); return successors.refresh(ORIGIN(this.input?.origin)); } }
export class FirstContactSuccessor extends SuccessorAction { static operation = 'successors.first-contact'; run({ successors }) { system(this.actor); return successors.firstContact(this.input ?? {}); } }
export class PresentSuccessor extends SuccessorAction { static operation = 'successors.present'; run({ successors }) { return successors.present(this.input ?? {}); } }
export class DrainSuccessors extends SuccessorAction { static operation = 'successors.drain'; run({ successors }) { system(this.actor); return successors.drain(this.input ?? {}); } }
export class ConfirmSuccessor extends SuccessorAction { static operation = 'successors.confirm'; run({ successors }) { if (this.actor?.kind !== 'operator') fault('forbidden', 'Only the relationship owner adopts a pending successor.', 403); return successors.confirm(ORIGIN(this.input?.origin), { digest: this.input?.digest, acknowledgeSourceActive: this.input?.acknowledgeSourceActive === true }); } }
export class DismissSuccessor extends SuccessorAction { static operation = 'successors.dismiss'; run({ successors }) { if (this.actor?.kind !== 'operator') fault('forbidden', 'Only the relationship owner dismisses a pending successor.', 403); return successors.dismiss(ORIGIN(this.input?.origin), { digest: this.input?.digest }); } }
export class ResolveSuccessor extends AppQuery { static operation = 'successors.resolve'; static deps = ['successors']; static refreshOn = [CHANGED]; fetch({ successors }) { system(this.actor); return successors.resolve(this.input ?? {}); } }
export class PendingSuccessors extends AppQuery { static operation = 'successors.pending'; static deps = ['successors']; static refreshOn = [CHANGED]; fetch({ successors }) { system(this.actor); return successors.pending(ORIGIN(this.input?.origin)); } }
export const SUCCESSOR_OPERATIONS = Object.freeze([TrackSuccessor, AdoptSuccessor, RefreshSuccessor, FirstContactSuccessor, PresentSuccessor, DrainSuccessors, ConfirmSuccessor, DismissSuccessor, ResolveSuccessor, PendingSuccessors]);
export { SuccessionError };
