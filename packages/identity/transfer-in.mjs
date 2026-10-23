// PORT-4: identity transfer-in at the destination (docs/architecture/identity-portability.md §3.1 steps 5–7, §3.4, §7,
// §7.1; docs/spec/identity-portability.md §7, §7.1, §9). Engine-first: `TransferInService` is the account-placement
// provider resource (dispatched in the account single writer by packages/runtime/account/transfer-in.mjs; provided as
// `lifecycle`, like PORT-2) and the `transfer-in.*` Actions/Queries at the end are its operations. `assessTransferIn`
// and `TransferInIntake` are the provider-level (pre-account) half: package checks and the identity reservation.
//
// Flag: IDENTITY_TRANSFER_IN_ENABLED (class c, requires SIGNUP_ENABLED, default off). It gates new intakes and new
// begins only. Polling, activation and cancellation of a transfer-in that exists follow the env kill switch
// (`background`), so a ramp-down never strands an identity whose source already committed.
//
// Flow (one account per `sub`; the account and the identity record share the `sub`):
//   1. Intake (provider level): `assessTransferIn` verifies the package (§9.1, key correspondence), applies the 3sln.me
//      checks (§9.3; design §7) against the source's live manifest, directory and identity document, and decides the
//      mode: `attested` (the source declares portability.v1 and lists the package key as active) or `unattested`
//      (only from a 3sln-format file, only while the source does not declare portability.v1 and does not serve the
//      identity as active; design §7, Q4, IP-R1-M7). `TransferInIntake.reserve` then creates the identity record in
//      status `pending-transfer`, bound to the package's signing key. Admission, Turnstile and enrolment are the
//      signup adapter's (PORT-6); the package is never stored before the user is enrolled (spec §9.2).
//   2. Begin (account, the enrolled owner): keys are stored under this provider's custody with the source's published
//      key history (`IdentityKeyRegistry.importTransfer`), and the move statement is signed by the imported key with
//      `seq`/`prev` continuing the source's `moves`.
//   3. Polling (attested): the statement is POSTed to the source's move endpoint with `transfer` and a per-source
//      `redirect_base` until it answers `attested` (verified under the source's pinned attestation keys, PORT-5) or
//      `refused`. The decision to host an unattested identity is stored at begin and re-checked before activation.
//   4. Activation (idempotent stages, before which nothing signs: the custody fence of keys.mjs): signing-key rotation
//      by a continuity statement from the imported key (P11; 3sln.me always rotates), a fresh certification key (never
//      one of an earlier host), the identity record `active` with `moves`, its identity URI, its origin principal and
//      `security.epoch` above the attested `aep`, then a new 3sln.me recovery file (a port; until the identity owner
//      wires an active-account issuance path the owner is told one is required).
//
// Deliberately refused in this slice (spec §9.3 and design §3.5 decide them; they need repository primitives the
// identity owner has not built): returns to 3sln.me (`return_unsupported`) and displacement of an unattested identity
// by an attested move (`displacement_unsupported`). Both are classified exactly as the spec says, then refused.
// Organization transfer-ins wait for the organizations slices.
//
// Records (account store):
//   transfer-in/v1          importing → posting ⇄ pending → activating → active | held (attestation not verifiable yet)
//                           unattested: importing → decided → activating → active
//                           terminal: refused | cancelled | failed
//   identity-cert-key/<owner>/<kid>/   certification keys (`use:"cert"`), pointer `certification-key` (sealed)
import { AppAction, AppQuery } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { isUUID, isUUIDv4 } from '../core/primitives.mjs';
import { key } from '../core/records.mjs';
import { verifyPackage, signMoveStatement, parseMoveStatement, statementDigest, validateRedirectBase, documentLineage, httpsOrigin, attestationKeyThumbprint, verifyMoveStatement, verifyMoveRecordLink, MAX_MOVES, MAX_MOVES_DOCUMENT_BYTES, SuccessionError } from './succession.mjs';
import { PortabilityUnavailable, signingKeysOf } from './successors.mjs';
import { identityURI } from './transfer-out.mjs';
import { securityState } from './service.mjs';

export const TRANSFER_IN_FLAG = 'IDENTITY_TRANSFER_IN_ENABLED';
export const TRANSFER_IN_KEY = 'transfer-in/v1';
export const TRANSFER_IN_PATH = '/bindle/portability/transfer-in';
export const REDIRECT_PREFIX = '/bindle/portability/from/';
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
export const TRANSFER_IN_TIMING = Object.freeze({ minPoll: MINUTE, maxPoll: DAY, backoffMax: 6 * HOUR, giveUp: 45 * DAY, heldRetry: HOUR, statementSkew: 5 * MINUTE });
export const TRANSFER_IN_STATES = Object.freeze(['importing', 'posting', 'pending', 'decided', 'activating', 'held', 'active', 'refused', 'cancelled', 'failed']);
const LIVE = new Set(['importing', 'posting', 'pending', 'decided', 'activating', 'held']), TERMINAL = new Set(['refused', 'cancelled', 'failed']);
export const ACTIVATION_STAGES = Object.freeze(['rotate', 'certification', 'identity', 'recovery']);
const CERT_PREFIX = 'identity-cert-key', CERT_POINTER = 'certification-key';
const DOCUMENT_BYTES = 16384;

const fail = (code, message, status = 400) => { throw new AppFault(code, message, status); };
const notFound = () => fail('not_found', 'Not found.', 404);
const unavailable = (message = 'Moving your identity here is temporarily unavailable.') => fail('transfer_in_unavailable', message, 503);
const refuse = (code, message) => fail(code, message, 409);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const seconds = ms => Math.floor(ms / 1000);
const exact = (value, names) => { if (value === undefined) return {}; if (!plain(value) || Object.keys(value).some(name => !names.includes(name))) fail('invalid_request', 'Unsupported transfer request.'); return value; };

/** New intakes and begins: the evaluated flag (class c, global). Errors and unknown rows are off. */
export function transferInEnabled(flags) { try { return flags.for({}).enabled(TRANSFER_IN_FLAG) === true; } catch { return false; } }
/** Continuation (polling, activation) follows only the env kill switch. */
export function transferInBackground(flags) { try { return flags.for({}).background(TRANSFER_IN_FLAG) === true; } catch { return false; } }
/** The `redirect_base` this destination gives one source (spec §5.2): unique per source origin at this destination. */
export const redirectBaseFor = (issuer, sourceIssuer) => `${issuer}${REDIRECT_PREFIX}${new URL(sourceIssuer).host}/`;

// ---- intake checks (provider level) -------------------------------------------------------------------------------

const point = jwk => ({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
/** §9.1–§9.3 and design §7. `input`: {package (object or JSON text), source:'package'|'file'}. Resolves the facts a
 * reservation and a begin need, or throws an owner-facing refusal. Never logs the package. */
export async function assessTransferIn({ input, source = 'package' }, { issuer, client, identity, pins, crypto = globalThis.crypto }) {
  if (!['package', 'file'].includes(source)) fail('invalid_request', 'Unsupported transfer request.');
  let pkg; try { pkg = await verifyPackage(input, { crypto }); } catch { fail('package_invalid', 'This identity package cannot be used.'); }
  if (!isUUIDv4(pkg.sub)) refuse('sub_invalid', 'This identity cannot be moved here.');
  if (pkg.kind !== 'person') refuse('organization_transfer_unavailable', 'Organization moves are not available yet.');
  if (pkg.from.iss === issuer) refuse('same_provider', 'This identity is already hosted here.');
  const keyThumbprint = await attestationKeyThumbprint(point(pkg.keys.signing.jwk), { crypto });
  // The source, live (spec §9.3 second bullet; design §7 "Checks").
  const facts = { reachable: false, portability: false, serving: null, keyMatch: false, kindMatch: false, sourceMoves: [], lineage: [] };
  try {
    const manifest = await client.manifest(pkg.from.iss);
    facts.reachable = manifest.status === 'ok';
    facts.portability = Boolean(manifest.status === 'ok' && manifest.portability?.move_endpoint && manifest.portability.attestation_jwks_uri);
    if (manifest.status === 'ok' && manifest.directory) {
      const found = await client.lookup(pkg.from.iss, pkg.sub);
      facts.serving = found.status === 'found' ? found.identity === pkg.from.identity ? 'active' : 'elsewhere' : found.status;
      if (found.status === 'found' && found.identity === pkg.from.identity) {
        const doc = await client.document(found.identity, { sub: pkg.sub });
        if (doc.status === 'ok') {
          const lineage = await documentLineage(signingKeysOf(doc.document), pkg.sub).catch(() => null), active = lineage?.at(-1);
          facts.keyMatch = Boolean(active && active.kid === pkg.keys.signing.kid && active.publicJwk.x === pkg.keys.signing.jwk.x && active.publicJwk.y === pkg.keys.signing.jwk.y);
          facts.kindMatch = (doc.document.kind ?? 'person') === pkg.kind;
          facts.lineage = lineage ?? []; facts.sourceMoves = doc.document.moves ?? []; facts.document = doc.document;
        }
      }
    }
  } catch (error) { if (!(error instanceof PortabilityUnavailable)) throw error; facts.reachable = false; }
  let mode;
  if (facts.portability) {
    if (facts.serving !== 'active' || !facts.keyMatch || !facts.kindMatch) refuse('source_key_mismatch', 'Your old provider does not list these keys as your current identity. Use your newest file or start the move at your old provider.');
    mode = 'attested';
  } else if (pkg.transfer !== undefined) refuse('source_cannot_attest', 'Your old provider cannot confirm this move.');
  else if (facts.serving === 'active' || facts.serving === 'elsewhere' || facts.serving === 'invalid') refuse('source_still_active', 'Your old provider still serves this identity. Move it from there instead.');
  else if (source !== 'file') refuse('unattested_requires_file', 'Without confirmation from your old provider, a move needs a 3sln.me-format recovery file.');
  else mode = 'unattested';
  // The source's chain (§7: the destination keeps listing it). For an attested move every earlier record must verify
  // offline against the source document's keys and pass the attestation-key pins; an unattested move never claims
  // the source's origin, so its fetched chain is kept only for `seq` continuity when it verifies offline.
  let sourceMoves = Array.isArray(facts.sourceMoves) ? facts.sourceMoves.slice(0, MAX_MOVES) : [];
  if (sourceMoves.length) {
    const ok = await offlineChain(sourceMoves, facts.lineage, pkg.from, crypto);
    if (!ok) { if (mode === 'attested') refuse('source_chain_invalid', 'Your old provider published a history that cannot be verified.'); sourceMoves = []; }
    else if (mode === 'attested') {
      if (sourceMoves.length >= MAX_MOVES) refuse('too_many_moves', 'This identity has moved too many times to move again.');
      for (const record of sourceMoves) {
        if (record.attestation === null) refuse('source_chain_invalid', 'Your old provider published a history that cannot be verified.');
        const parsed = parseMoveStatement(record.statement), checked = await pins.check(parsed.payload.from.iss, record.attestation, parsed, { fresh: true }).catch(error => { if (error instanceof PortabilityUnavailable) unavailable(); throw error; });
        if (!checked.ok) refuse('source_chain_invalid', 'Your old provider published a history that cannot be verified.');
      }
    }
  }
  const origin = mode === 'attested' ? { iss: sourceMoves.length ? parseMoveStatement(sourceMoves[0].statement).payload.from.iss : pkg.from.iss, sub: pkg.sub } : { iss: issuer, sub: pkg.sub };
  // §9.3 first bullet, with the IP-R1-M5 origin rule and the two exceptions.
  const existing = await identity.get(pkg.sub);
  if (existing && !(existing.status === 'transfer-released' || existing.status === 'pending-transfer' && existing.transferIn?.keyThumbprint === keyThumbprint && existing.transferIn.from?.iss === pkg.from.iss)) {
    if (existing.transferIn?.mode === 'unattested' && mode === 'attested') refuse('displacement_unsupported', 'This identity is hosted here without confirmation. Contact support to replace it with the confirmed move.');
    const movedOut = existing.moved?.statementDigest && await Promise.all(sourceMoves.map(record => statementDigest(parseMoveStatement(record.statement).input, { crypto }))).then(list => list.includes(existing.moved.statementDigest));
    if (movedOut && mode === 'attested') refuse('return_unsupported', 'Moving back to 3sln.me is not available yet.');
    refuse('sub_in_use', 'This identity cannot be moved here.');
  }
  const last = sourceMoves.at(-1);
  // The published key history (spec §7.1): the active key's continuity ancestors, with the source's own times.
  const raw = kid => signingKeysOf(facts.document).find(entry => entry?.kid === kid) ?? {};
  const described = entry => { const published = raw(entry.kid), when = name => Number.isSafeInteger(published[name]) && published[name] >= 0 ? published[name] : undefined; return { kid: entry.kid, publicJwk: point(entry.publicJwk), state: entry.state === 'revoked' ? 'revoked' : 'retired', created: when('created'), retired: when('retired'), revoked: when('revoked'), predecessor: entry.predecessor ?? null, continuity: entry.continuity ?? null }; };
  const active = facts.lineage.at(-1);
  return { package: pkg, mode, origin, source, keyThumbprint, seq: sourceMoves.length + 1, prev: last ? await statementDigest(parseMoveStatement(last.statement).input, { crypto }) : null, sourceMoves,
    history: facts.keyMatch ? facts.lineage.slice(0, -1).slice(-12).map(described) : [], activeEntry: facts.keyMatch && active ? { predecessor: active.predecessor ?? null, continuity: active.continuity ?? null, created: described(active).created } : null,
    facts: { reachable: facts.reachable, portability: facts.portability, serving: facts.serving } };
}
async function offlineChain(moves, lineage, last, crypto) {
  if (!lineage?.length) return false;
  const index = new Map(lineage.map((entry, i) => [entry.kid, i])); let prev = null, low = 0;
  try {
    for (const record of moves) {
      const parsed = parseMoveStatement(record.statement);
      await verifyMoveRecordLink(prev, parsed, { crypto });
      const position = index.get(parsed.header.kid); if (position === undefined || position < low) return false;
      await verifyMoveStatement(parsed.value, lineage[position].publicJwk, { crypto }); low = position; prev = parsed;
    }
  } catch { return false; }
  return prev.payload.to.iss === last.iss && prev.payload.to.identity === last.identity;
}

/** Provider-level intake operations. `ports`: {issuer, identity, client, pins}. */
export class TransferInIntake {
  constructor({ ports, flags, clock, random, crypto: webCrypto = globalThis.crypto }) {
    if (typeof flags?.for !== 'function' || typeof clock?.now !== 'function' || typeof random?.uuid !== 'function') throw new TypeError('Transfer-in intake dependencies are required.');
    Object.assign(this, { portSource: ports, flags, clock, random, crypto: webCrypto });
  }
  get ports() { const value = typeof this.portSource === 'function' ? this.portSource() : this.portSource; if (!plain(value) || !value.identity || !value.client || !value.pins || !httpsOrigin(value.issuer)) unavailable('Moving your identity here is not configured.'); return value; }
  /** The facts a page shows before signup: mode and source, never key material. Intake actor (trusted adapter). */
  async check(actor, input) {
    if (actor?.kind !== 'intake') fail('forbidden', 'Transfer-in intake requires a trusted adapter.', 403);
    if (!transferInEnabled(this.flags)) notFound();
    const v = exact(input, ['package', 'source']), facts = await assessTransferIn({ input: v.package, source: v.source ?? 'package' }, { ...this.ports, crypto: this.crypto });
    return { sub: facts.package.sub, kind: facts.package.kind, from: facts.package.from, mode: facts.mode, label: facts.mode === 'unattested' ? `moved without confirmation from ${new URL(facts.package.from.iss).host}` : null };
  }
  /** Creates the `pending-transfer` identity record for the package's `sub`, bound to its signing key. */
  async reserve(actor, input) {
    if (actor?.kind !== 'intake') fail('forbidden', 'Transfer-in intake requires a trusted adapter.', 403);
    if (!transferInEnabled(this.flags)) notFound();
    const v = exact(input, ['package', 'source']), ports = this.ports, facts = await assessTransferIn({ input: v.package, source: v.source ?? 'package' }, { ...ports, crypto: this.crypto });
    const reserved = await ports.identity.reserve(facts.package.sub, { reservation: this.random.uuid(), kind: facts.package.kind, from: facts.package.from, mode: facts.mode, origin: facts.origin, keyThumbprint: facts.keyThumbprint, now: this.clock.now() });
    if (reserved?.ok !== true) refuse('sub_in_use', 'This identity cannot be moved here.');
    return { sub: facts.package.sub, mode: facts.mode, reservation: reserved.reservation, handle: reserved.handle ?? null };
  }
}

// ---- views --------------------------------------------------------------------------------------------------------

export function transferInView(record) {
  if (!record) return { state: 'none' };
  return { state: record.state, mode: record.mode, from: record.from, to: record.to, createdAt: record.createdAt,
    ...record.mode === 'unattested' ? { label: `moved without confirmation from ${new URL(record.from.iss).host}` } : {},
    ...LIVE.has(record.state) ? { nextAt: record.nextAt ?? null, authorizeUrl: record.authorizeUrl ?? null, sourceBound: record.sourceBound === true } : {},
    ...record.state === 'held' ? { reason: record.reason } : {},
    ...record.state === 'active' ? { activatedAt: record.activatedAt, recoveryRequired: record.recoveryRequired === true, attestationFirstUse: record.attestationFirstUse === true } : {},
    ...TERMINAL.has(record.state) ? { reason: record.reason ?? null, endedAt: record.endedAt ?? null } : {} };
}

// ---- the account service ------------------------------------------------------------------------------------------

export class TransferInService {
  #tail = Promise.resolve();
  /** `executor`: the account controller (metadata) or a test composition. `ports`: TransferInPorts or a thunk:
   * {issuer, identity, client, pins, keys:{import, rotate, statementSigner, destroy}, seal, recovery?}. */
  constructor({ executor, ports, flags, clock, random, log = () => {}, wake, crypto: webCrypto = globalThis.crypto }) {
    if (!executor?.metadata || typeof flags?.for !== 'function' || typeof clock?.now !== 'function' || typeof random?.uuid !== 'function') throw new TypeError('Transfer-in dependencies are required.');
    Object.assign(this, { executor, portSource: ports, flags, clock, random, log, wake, crypto: webCrypto });
  }
  get metadata() { return this.executor.metadata; }
  get ports() { const value = typeof this.portSource === 'function' ? this.portSource() : this.portSource; return plain(value) ? value : {}; }
  port(name) { const value = this.ports[name]; if (!value) unavailable('Moving your identity here is not configured.'); return value; }
  get issuer() { const issuer = this.ports.issuer; if (!httpsOrigin(issuer)) unavailable('Moving your identity here is not configured.'); return issuer; }
  now() { const now = this.clock.now(); if (!time(now)) unavailable(); return now; }
  serial(work) { const run = this.#tail.then(work, work); this.#tail = run.catch(() => {}); return run; }
  async arm(at) { if (!time(at)) return; try { if (typeof this.wake === 'function') await this.wake(at); } catch {} }
  async bound(owner) { const stored = await this.metadata.get('owner'); if (stored !== owner) fail(stored === undefined ? 'account_unavailable' : 'forbidden', stored === undefined ? 'Account unavailable.' : 'Account owner mismatch.', stored === undefined ? 409 : 403); }
  async patch(id, mutate) {
    return this.metadata.transaction(async tx => {
      const current = await tx.get(TRANSFER_IN_KEY); if (current?.id !== id) return null;
      const next = mutate(structuredClone(current)); if (!next) return null; next.revision = current.revision + 1; await tx.put(TRANSFER_IN_KEY, next); return next;
    });
  }

  /** Step 2. Actor: the enrolled owner of the pending identity ({kind:'owner', owner}) or the trusted signup adapter
   * ({kind:'intake', owner}). `input`: {package, source}. Idempotent for the same package. */
  async begin(actor, input) {
    if (!['owner', 'intake'].includes(actor?.kind) || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401);
    return this.serial(() => this.beginOnce(actor.owner, input));
  }
  async beginOnce(owner, input) {
    if (!transferInEnabled(this.flags)) notFound();
    const v = exact(input, ['package', 'source']), ports = this.ports;
    for (const name of ['identity', 'client', 'pins', 'keys']) if (!ports[name]) unavailable('Moving your identity here is not configured.');
    await this.bound(owner);
    // Idempotent before any fetch: once the source commits it no longer lists the key, so a repeated begin for the
    // same package answers from the record.
    let early; try { early = await verifyPackage(v.package, { crypto: this.crypto }); } catch { fail('package_invalid', 'This identity package cannot be used.'); }
    const thumbprint = await attestationKeyThumbprint(point(early.keys.signing.jwk), { crypto: this.crypto }), prior = await this.metadata.get(TRANSFER_IN_KEY);
    if (early.sub === owner && prior?.keyThumbprint === thumbprint && prior.state !== 'importing') { if (LIVE.has(prior.state) || prior.state === 'active') return transferInView(prior); }
    const facts = await assessTransferIn({ input: v.package, source: v.source ?? 'package' }, { issuer: this.issuer, client: ports.client, identity: ports.identity, pins: ports.pins, crypto: this.crypto });
    const pkg = facts.package; if (pkg.sub !== owner) fail('forbidden', 'This package is for another identity.', 403);
    const identity = await ports.identity.get(owner);
    if (identity?.status !== 'pending-transfer' || identity.transferIn?.keyThumbprint !== facts.keyThumbprint || identity.transferIn.from?.iss !== pkg.from.iss || identity.transferIn.mode !== facts.mode) refuse('reservation_mismatch', 'Start moving your identity again.');
    const reservation = identity.transferIn.reservation, now = this.now();
    let record = await this.metadata.get(TRANSFER_IN_KEY);
    if (record && record.reservation === reservation && record.keyThumbprint === facts.keyThumbprint && record.state !== 'importing') { if (LIVE.has(record.state) || record.state === 'active') return transferInView(record); refuse('transfer_in_ended', 'This move ended. Start again.'); }
    if (record && record.reservation !== reservation && LIVE.has(record.state)) refuse('transfer_in_pending', 'A move here is already in progress.');
    if (!record || record.reservation !== reservation) {
      const to = { iss: this.issuer, identity: identityURI(this.issuer, owner) }, redirectBase = redirectBaseFor(this.issuer, pkg.from.iss);
      validateRedirectBase(redirectBase, this.issuer);
      const fresh = { v: 1, id: this.random.uuid(), owner, reservation, keyThumbprint: facts.keyThumbprint, kind: pkg.kind, mode: facts.mode, state: 'importing', source: facts.source,
        from: pkg.from, to, origin: facts.origin, transfer: pkg.transfer ?? null, redirectBase, seq: facts.seq, prev: facts.prev, sourceMoves: facts.sourceMoves,
        statement: null, sourceBound: false, attempts: 0, nextAt: now, authorizeUrl: null, attestation: null, aep: null, stages: {}, createdAt: now, revision: 1 };
      record = await this.metadata.transaction(async tx => { const live = await tx.get(TRANSFER_IN_KEY); if (live && live.reservation !== reservation && LIVE.has(live.state)) refuse('transfer_in_pending', 'A move here is already in progress.'); if (live?.reservation === reservation && live.state !== 'importing') return live; await tx.put(TRANSFER_IN_KEY, fresh); return fresh; });
    }
    // Custody before activation (spec §9.3 third bullet): the package keys with the source's published history.
    const lineageEntry = facts.activeEntry;
    await this.port('keys').import(owner, {
      signing: { kid: pkg.keys.signing.kid, jwk: pkg.keys.signing.jwk, ...lineageEntry ? { predecessor: lineageEntry.predecessor, continuity: lineageEntry.continuity, created: lineageEntry.created } : {} },
      ...pkg.keys.encryption ? { encryption: pkg.keys.encryption } : {},
      history: facts.history,
    });
    record = await this.patch(record.id, r => { if (r.state !== 'importing') return null; r.state = r.mode === 'attested' ? 'posting' : 'decided'; if (r.mode === 'unattested') r.decision = { at: now, policy: 'design-7-q4-3sln-file' }; return r; }) ?? await this.metadata.get(TRANSFER_IN_KEY);
    this.log({ action: 'transfer-in-begun', owner, mode: record.mode });
    record = await this.sign(record) ?? record;
    const outcome = await this.advance(record);
    await this.arm(outcome.wakeAt ?? null);
    return transferInView(outcome.record ?? record);
  }
  /** Signs the move statement with the imported key (the only pre-activation signature). */
  async sign(record) {
    if (record.statement || !['posting', 'pending', 'decided'].includes(record.state)) return record;
    const signer = await this.port('keys').statementSigner(record.owner);
    if (!signer) unavailable();
    const payload = { bindle: 'identity-move', v: 1, sub: record.owner, kind: record.kind, seq: record.seq, prev: record.prev, from: record.from, to: record.to, iat: seconds(this.now()) };
    const jws = await signMoveStatement({ kid: signer.kid, payload }, signer.privateKey, { crypto: this.crypto });
    const digest = await statementDigest(parseMoveStatement(jws).input, { crypto: this.crypto });
    return this.patch(record.id, r => { if (r.statement || !['posting', 'pending', 'decided'].includes(r.state)) return null; r.statement = { jws, digest, kid: signer.kid, at: this.now() }; return r; });
  }

  // ---- the state machine ----

  async advance(record) {
    let current = record; const now = this.now();
    if (!current || !LIVE.has(current.state)) return { record: current, action: current?.state ?? 'none' };
    if (current.state === 'importing') return { record: current, action: 'importing' };
    if (!current.statement) current = await this.sign(current) ?? await this.metadata.get(TRANSFER_IN_KEY);
    if (!transferInBackground(this.flags)) return { record: current, action: 'killed', wakeAt: now + HOUR };
    if (['posting', 'pending'].includes(current.state)) {
      if (now - current.createdAt >= TRANSFER_IN_TIMING.giveUp) return { record: await this.end(current, 'failed', 'gave-up'), action: 'failed' };
      if (time(current.nextAt) && current.nextAt > now) return { record: current, action: 'wait', wakeAt: current.nextAt };
      current = await this.poll(current);
      if (current.state !== 'activating') return { record: current, action: current.state, wakeAt: LIVE.has(current.state) ? current.nextAt : null };
    }
    if (current.state === 'held') {
      if (time(current.nextAt) && current.nextAt > now) return { record: current, action: 'held', wakeAt: current.nextAt };
      current = await this.verifyAttestation(current, current.attestation);
      if (current.state !== 'activating') return { record: current, action: current.state, wakeAt: current.nextAt ?? null };
    }
    if (current.state === 'decided') {
      current = await this.recheckUnattested(current);
      if (current.state !== 'activating') return { record: current, action: current.state, wakeAt: LIVE.has(current.state) ? current.nextAt : null };
    }
    if (current.state === 'activating') { current = await this.activate(current); return { record: current, action: current.state, wakeAt: current.state === 'activating' ? now + MINUTE : null }; }
    return { record: current, action: current.state };
  }
  /** One POST to the source's move endpoint (spec §5.2); the identical body every time. */
  async poll(record) {
    const now = this.now(), client = this.port('client');
    let response;
    try { response = await client.move(record.from.iss, { v: 1, statement: record.statement.jws, transfer: record.transfer?.id ?? null, redirect_base: record.redirectBase }); }
    catch (error) {
      if (!(error instanceof PortabilityUnavailable) && error?.code !== 'invalid_url') throw error;
      const attempts = (record.attempts ?? 0) + 1, wait = Math.min(TRANSFER_IN_TIMING.backoffMax, MINUTE * 2 ** Math.min(attempts, 10));
      return await this.patch(record.id, r => { if (!['posting', 'pending'].includes(r.state)) return null; r.attempts = attempts; r.nextAt = now + Math.max(wait, (error.retryAfter ?? 0) * 1000); r.lastResult = 'unavailable'; return r; }) ?? record;
    }
    this.log({ action: 'transfer-in-poll', owner: record.owner, status: response.status });
    if (response.status === 'attested') {
      const bound = await this.patch(record.id, r => { if (!['posting', 'pending'].includes(r.state)) return null; r.sourceBound = true; r.attestation = response.attestation; r.redirectUntil = response.redirect_until; return r; }) ?? record;
      return this.verifyAttestation(bound, response.attestation);
    }
    if (response.status === 'pending') {
      const wait = Math.min(TRANSFER_IN_TIMING.maxPoll, Math.max(TRANSFER_IN_TIMING.minPoll, response.retry_after * 1000));
      return await this.patch(record.id, r => { if (!['posting', 'pending'].includes(r.state)) return null; Object.assign(r, { state: 'pending', sourceBound: true, attempts: 0, nextAt: now + wait, authorizeUrl: response.authorize_url ?? null, lastResult: 'pending' }); return r; }) ?? record;
    }
    // `refused` is uniform at the source (cancelled, expired, already attested elsewhere, never authorized);
    // `unsupported`: the source withdrew its move endpoint.
    return this.end(record, 'refused', response.status === 'refused' ? 'source-refused' : 'source-unsupported');
  }
  /** Spec §7 activation precondition: a verified attestation for the last move, under the source's pinned keys. */
  async verifyAttestation(record, attestation) {
    const now = this.now(); let checked;
    try { checked = await this.port('pins').check(record.from.iss, attestation, parseMoveStatement(record.statement.jws), { fresh: true }); }
    catch (error) { if (!(error instanceof PortabilityUnavailable)) throw error; checked = { ok: false, reason: 'attestation-unavailable' }; }
    if (!checked.ok) {
      // The source has committed and destroyed its copies; this host must not drop the identity. It holds, alerts and
      // retries (the source's attestation keys may be refetched, or an operator resolves an attestation reset).
      this.log({ action: 'transfer-in-held', owner: record.owner, reason: checked.reason });
      return await this.patch(record.id, r => { if (!['posting', 'pending', 'held'].includes(r.state)) return null; Object.assign(r, { state: 'held', reason: checked.reason, attestation, nextAt: now + TRANSFER_IN_TIMING.heldRetry }); return r; }) ?? record;
    }
    return await this.patch(record.id, r => { if (!['posting', 'pending', 'held'].includes(r.state)) return null; Object.assign(r, { state: 'activating', attestation, aep: checked.aep, attestationFirstUse: checked.firstUse, attestationKey: { kid: checked.kid, thumbprint: checked.thumbprint }, verifiedAt: now, reason: undefined }); return r; }) ?? record;
  }
  /** Design §7: an unattested transfer-in is refused while the source declares portability.v1 or serves the identity
   * as active, checked at intake and again here, before activation. An unreachable source is the case Q4 exists for. */
  async recheckUnattested(record) {
    const client = this.port('client');
    let active = false;
    try {
      const manifest = await client.manifest(record.from.iss);
      if (manifest.status === 'ok' && manifest.portability?.move_endpoint) active = true;
      else if (manifest.status === 'ok' && manifest.directory) { const found = await client.lookup(record.from.iss, record.owner); active = found.status === 'found' || found.status === 'invalid'; }
    } catch (error) { if (!(error instanceof PortabilityUnavailable)) throw error; }
    if (active) return this.end(record, 'refused', 'source-active');
    return await this.patch(record.id, r => { if (r.state !== 'decided') return null; r.state = 'activating'; r.aep = 0; return r; }) ?? record;
  }
  /** Activation stages (spec §7, §7.1; design §7). Each is idempotent and recorded; nothing signs before `active`. */
  async activate(record) {
    let current = record; const owner = current.owner, ports = this.ports;
    const run = async (stage, work) => {
      if (current.stages[stage]) return true;
      let evidence; try { evidence = await work(); } catch (error) { this.log({ action: 'transfer-in-stage-retry', owner, stage, code: error?.code ?? 'unavailable' }); return false; }
      current = await this.patch(current.id, r => { if (r.state !== 'activating') return null; r.stages = { ...r.stages, [stage]: { at: this.now(), ...plain(evidence) ? evidence : {} } }; return r; }) ?? current;
      return true;
    };
    // 1. P11: the imported key signs a continuity statement naming a fresh key, and is retired (never revoked).
    if (!await run('rotate', async () => { const rotated = await this.port('keys').rotate(owner, { expectedKid: current.statement.kid }); return { kid: rotated.kid, previous: rotated.previous }; })) return current;
    // 2. A fresh certification key; no earlier host's key is ever reused (spec §7, R4-H1).
    if (!await run('certification', async () => mintCertificationKey(this.metadata, owner, { seal: this.port('seal'), clock: () => this.now(), crypto: this.crypto }))) return current;
    // 3. The identity record: active, with `moves`, its identity URI and origin, and an epoch above the attested aep.
    const moves = [...current.sourceMoves, { statement: current.statement.jws, attestation: current.mode === 'attested' ? current.attestation : null }];
    if (!await run('identity', async () => { const result = await this.port('identity').activate(owner, { reservation: current.reservation, mode: current.mode, origin: current.origin, moves, identityUri: current.to.identity, aepFloor: (current.aep ?? 0) + 1, label: current.mode === 'unattested' ? `moved without confirmation from ${new URL(current.from.iss).host}` : null }); if (result?.ok !== true) throw Object.assign(new Error('identity not activated'), { code: result?.status ?? 'identity_unavailable' }); return { status: 'active' }; })) return current;
    // 4. A new recovery file in this provider's format, holding the rotated key (design §7 "Setup").
    await run('recovery', async () => { const recovery = ports.recovery; if (typeof recovery?.issue !== 'function') return { required: true }; const issued = await recovery.issue(owner); return { issued: issued?.ok === true, required: issued?.ok !== true }; });
    const now = this.now();
    current = await this.patch(current.id, r => { if (r.state !== 'activating' || ACTIVATION_STAGES.some(stage => !r.stages[stage])) return null; Object.assign(r, { state: 'active', activatedAt: now, recoveryRequired: r.stages.recovery?.required === true, nextAt: null }); return r; }) ?? current;
    if (current.state === 'active') this.log({ action: 'transfer-in-activated', owner, mode: current.mode });
    return current;
  }
  async end(record, state, reason) {
    const now = this.now();
    const next = await this.patch(record.id, r => { if (!LIVE.has(r.state) || r.state === 'activating') return null; Object.assign(r, { state, reason, endedAt: now, nextAt: null }); return r; });
    if (!next) return await this.metadata.get(TRANSFER_IN_KEY) ?? record;
    this.log({ action: `transfer-in-${state}`, owner: next.owner, reason });
    // Custody ends and the reservation is released: a never-activated identity keeps nothing.
    try { await this.port('keys').destroy(next.owner); } catch { /* retried by the next step's cleanup */ }
    try { await this.port('identity').release(next.owner, { reservation: next.reservation }); } catch {}
    return next;
  }

  // ---- owner and system actions ----

  /** Cancels before the source bound our statement. Afterwards the source holds an authorization that names this
   * host and may commit; cancelling here would strand the identity, so the owner cancels at the source instead. */
  async cancel(actor, input) {
    return this.serial(async () => {
      if (!['owner', 'system'].includes(actor?.kind) || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401);
      exact(input, []); await this.bound(actor.owner);
      const record = await this.metadata.get(TRANSFER_IN_KEY);
      if (!record || !LIVE.has(record.state)) return transferInView(record);
      if (record.sourceBound || ['activating', 'held'].includes(record.state)) refuse('cancel_at_source', 'Your old provider is already processing this move. Cancel it there.');
      return transferInView(await this.end(record, 'cancelled', actor.kind === 'system' ? 'system' : 'owner'));
    });
  }
  step(actor) {
    if (actor?.kind !== 'system' || !isUUID(actor.owner)) fail('forbidden', 'Transfer steps require a system actor.', 403);
    return this.serial(async () => {
      const record = await this.metadata.get(TRANSFER_IN_KEY);
      if (!record || record.owner !== actor.owner) return { action: 'none' };
      if (TERMINAL.has(record.state)) { try { await this.port('keys').destroy(record.owner); } catch {} return { action: record.state }; }
      const outcome = await this.advance(record); const wakeAt = outcome.wakeAt ?? null; if (wakeAt) await this.arm(wakeAt);
      return { action: outcome.action, ...wakeAt ? { wakeAt } : {}, ...outcome.record?.state === 'active' ? { active: true } : {} };
    });
  }
  async status(actor) {
    if (!['owner', 'system'].includes(actor?.kind) || !isUUID(actor.owner)) fail('unauthorized', 'Sign in to continue.', 401);
    await this.bound(actor.owner);
    return transferInView(await this.metadata.get(TRANSFER_IN_KEY));
  }
}

// ---- certification keys (spec §7; organizations §3a.3 `use:"cert"`) ----------------------------------------------

/** Mints this host's certification key for `owner`, retiring any earlier one. Provider-held, never in a file or
 * package, no continuity (the live identity document is their only authority). Idempotent per activation stage. */
export async function mintCertificationKey(metadata, owner, { seal, clock = () => Date.now(), crypto = globalThis.crypto }) {
  if (typeof seal !== 'function') throw Object.assign(new Error('Certification keys need sealing.'), { code: 'identity_keys_unavailable' });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey), sealed = await seal(await crypto.subtle.exportKey('jwk', pair.privateKey)), kid = crypto.randomUUID(), now = clock();
  await metadata.transaction(async tx => {
    for (const [path, value] of await tx.list({ prefix: key(CERT_PREFIX, owner) })) if (value?.state === 'active') await tx.put(path, { ...value, state: 'retired', retiredAt: now });
    await tx.put(key(CERT_PREFIX, owner, kid), { owner, kid, alg: 'ES256', publicJwk: { kty: 'EC', crv: 'P-256', x, y }, state: 'active', createdAt: now });
    await tx.put(CERT_POINTER, { owner, kid, encrypted: sealed });
  });
  return { kid };
}
/** This host's certification keys for `owner` (public descriptors). */
export async function certificationKeys(metadata, owner) {
  return [...(await metadata.list({ prefix: key(CERT_PREFIX, owner) })).values()].filter(row => row?.owner === owner).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).map(row => ({ kid: row.kid, alg: 'ES256', publicJwk: row.publicJwk, state: row.state, createdAt: row.createdAt ?? null }));
}

// ---- identity documents (organizations §3a.3 with spec §7) ----------------------------------------------------

/** The identity document of an active identity, or null (uniform 404) for anything else. `signing` is the key
 * registry history (descriptors with `created`/`retired` seconds, `predecessor`, `continuity`); a moved identity lists
 * every key with its continuity chain (spec §7.1, AMD-P10). Fails closed (null) above the size bounds. */
export function identityDocument({ issuer, identity, signing = [], certification = [] }) {
  if (!httpsOrigin(issuer) || identity?.status !== 'active' || !isUUID(identity.id)) return null;
  const keys = [
    ...signing.filter(entry => entry?.alg === 'ES256' && ['active', 'retired', 'revoked'].includes(entry.state)).map(entry => ({ kid: entry.kid, use: 'sig', alg: 'ES256', jwk: point(entry.publicJwk), state: entry.state, ...Number.isSafeInteger(entry.created) ? { created: entry.created } : {}, ...entry.state === 'retired' && Number.isSafeInteger(entry.retired) ? { retired: entry.retired } : {}, predecessor: entry.predecessor ?? null, continuity: entry.continuity ?? null })),
    ...certification.filter(entry => ['active', 'retired', 'revoked'].includes(entry?.state)).map(entry => ({ kid: entry.kid, use: 'cert', alg: 'ES256', jwk: point(entry.publicJwk), state: entry.state, ...time(entry.createdAt) ? { created: seconds(entry.createdAt) } : {} })),
  ];
  if (keys.filter(entry => entry.use === 'sig' && entry.state === 'active').length !== 1) return null;
  const moves = Array.isArray(identity.moves) && identity.moves.length ? identity.moves.map(record => ({ statement: record.statement, attestation: record.attestation ?? null })) : null;
  const document = { v: 1, iss: issuer, sub: identity.id, kind: identity.kind === 'organization' ? 'organization' : 'person', ...typeof identity.handle === 'string' ? { handle: identity.handle } : {}, keys, ...moves ? { moves } : {} };
  return new TextEncoder().encode(JSON.stringify(document)).length <= (moves ? MAX_MOVES_DOCUMENT_BYTES : DOCUMENT_BYTES) ? document : null;
}
/** The directory `?sub=` answer (organizations §3a.2) for an active identity, or null (uniform 404). */
export function directoryAnswer({ issuer, identity }) {
  if (!httpsOrigin(issuer) || identity?.status !== 'active' || !isUUID(identity.id)) return null;
  return { iss: issuer, sub: identity.id, identity: identity.identityUri ?? identityURI(issuer, identity.id) };
}

// ---- identity port over the identity repository ---------------------------------------------------------------

/** Trusted transfer-in identity port (never an HTTP operation) over an identity repository with get, create,
 * compareAndSwap and allocateFreeHandle (the Node IdentityRepository, the Worker ShardedIdentityRepository). */
export function transferInIdentityPort(repository, { clock = () => Date.now(), crypto: webCrypto = globalThis.crypto } = {}) {
  if (typeof repository?.get !== 'function' || typeof repository.compareAndSwap !== 'function' || typeof repository.create !== 'function') throw new TypeError('An identity repository is required.');
  const cas = async (sub, mutate) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const account = await repository.get(sub); if (!account || account.id !== sub) return { ok: false, status: 'missing' };
      const next = structuredClone(account), outcome = mutate(next, account);
      if (outcome?.write !== true) return { ok: outcome?.ok === true, ...outcome?.status ? { status: outcome.status } : {}, ...outcome?.value };
      next.revision = account.revision + 1;
      if (await repository.compareAndSwap(sub, account.revision, next)) return { ok: true, ...outcome?.value };
    }
    return { ok: false, status: 'conflict' };
  };
  const audit = (account, type) => { account.audit = [...(account.audit || []).slice(-99), { id: webCrypto.randomUUID(), type, at: clock() }]; };
  const marker = ({ reservation, kind, from, mode, origin, keyThumbprint, now }) => ({ v: 1, reservation, kind, from: structuredClone(from), mode, origin: structuredClone(origin), keyThumbprint, reservedAt: now });
  return Object.freeze({
    async get(sub) {
      if (!isUUID(sub)) throw new TypeError('Invalid account identifier');
      const account = await repository.get(sub); if (!account || account.id !== sub) return null;
      return { id: account.id, status: account.status, kind: account.kind === 'organization' ? 'organization' : 'person', handle: account.handle ?? null, transferIn: plain(account.transferIn) ? structuredClone(account.transferIn) : null, moved: plain(account.moved) ? { statementDigest: account.moved.statementDigest ?? null } : null, moves: Array.isArray(account.moves) ? structuredClone(account.moves) : null, identityUri: account.identityUri ?? null, origin: account.origin ?? null, security: securityState(account) };
    },
    /** Creates (or re-reserves a released) `pending-transfer` record. Idempotent for the same key and source. */
    async reserve(sub, input) {
      if (!isUUIDv4(sub)) return { ok: false, status: 'invalid' };
      const now = input.now ?? clock(), existing = await repository.get(sub);
      if (!existing) {
        if (typeof repository.allocateFreeHandle !== 'function') return { ok: false, status: 'unsupported' };
        const assignmentId = webCrypto.randomUUID(), handle = await repository.allocateFreeHandle(null, sub, assignmentId);
        const account = { id: sub, assignmentId, nameAssignmentId: assignmentId, revision: 0, handle, status: 'pending-transfer', kind: input.kind === 'organization' ? 'organization' : 'person',
          admission: { version: 1, kind: 'transfer-in', plan: 'free' }, createdAt: now, lastActiveAt: now, security: { epoch: 0, changedAt: now }, credentials: [], sessions: [], challenges: [], audit: [], recoveryHash: null, emailLoginEnabled: false, passwordHash: null,
          transferIn: marker({ ...input, now }) };
        audit(account, 'transfer-in-reserved');
        if (await repository.create(account)) return { ok: true, reservation: input.reservation, handle };
        return { ok: false, status: 'conflict' };
      }
      return cas(sub, account => {
        if (account.status === 'pending-transfer' && account.transferIn?.keyThumbprint === input.keyThumbprint && account.transferIn.from?.iss === input.from.iss) return { ok: true, value: { reservation: account.transferIn.reservation, handle: account.handle } };
        if (account.status !== 'transfer-released') return { ok: false, status: 'sub_in_use' };
        Object.assign(account, { status: 'pending-transfer', transferIn: marker({ ...input, now }), sessions: [], challenges: [] }); audit(account, 'transfer-in-reserved');
        return { ok: true, write: true, value: { reservation: input.reservation, handle: account.handle } };
      });
    },
    /** A never-activated reservation ends (refused, cancelled, failed). The handle stays claimed for this `sub`. */
    async release(sub, { reservation }) {
      return cas(sub, account => {
        if (account.status !== 'pending-transfer' || account.transferIn?.reservation !== reservation) return { ok: true };
        Object.assign(account, { status: 'transfer-released', sessions: [], challenges: [] }); account.transferIn = { ...account.transferIn, releasedAt: clock() }; audit(account, 'transfer-in-released');
        return { ok: true, write: true };
      });
    },
    /** Activation (spec §7): status active, `moves`, identity URI, origin principal and `security.epoch` ≥ aepFloor. */
    async activate(sub, { reservation, mode, origin, moves, identityUri, aepFloor, label }) {
      return cas(sub, account => {
        if (account.status === 'active' && account.transferIn?.reservation === reservation) return { ok: true };
        if (account.status !== 'pending-transfer' || account.transferIn?.reservation !== reservation) return { ok: false, status: account.status };
        const now = clock(), security = securityState(account);
        Object.assign(account, { status: 'active', moves: structuredClone(moves), identityUri, origin: structuredClone(origin), security: { epoch: Math.max(security.epoch, aepFloor), changedAt: Math.max(security.changedAt, now) } });
        account.transferIn = { ...account.transferIn, mode, activatedAt: now, ...label ? { label } : {} };
        audit(account, 'transfer-in-activated'); return { ok: true, write: true };
      });
    },
  });
}

// ---- engine operations ----------------------------------------------------------------------------------------
// Provided under the catalogued `lifecycle` name, as PORT-2's transfer-out. Actors are built by trusted adapters only.
// Every operation is terms-exempt: arriving must not require accepting new terms before the account exists.
const CHANGED = 'transfer-in-changed';
class TransferInAction extends AppAction { static deps = ['lifecycle']; static changes = CHANGED; static termsGate = 'exempt'; }
export class BeginTransferIn extends TransferInAction { static operation = 'transfer-in.begin'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.begin(this.actor, this.input); } }
export class CancelTransferIn extends TransferInAction { static operation = 'transfer-in.cancel'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.cancel(this.actor, this.input); } }
export class StepTransferIn extends TransferInAction { static operation = 'transfer-in.step'; static lifecycle = 'suspended'; run({ lifecycle }) { return lifecycle.step(this.actor); } }
export class TransferInStatus extends AppQuery { static operation = 'transfer-in.status'; static deps = ['lifecycle']; static refreshOn = [CHANGED]; static lifecycle = 'suspended'; static termsGate = 'exempt'; fetch({ lifecycle }) { return lifecycle.status(this.actor); } }
export const TRANSFER_IN_OPERATIONS = Object.freeze([BeginTransferIn, CancelTransferIn, StepTransferIn, TransferInStatus]);
// Provider-level intake (edge placement): provided as `lifecycle` in the intake engine too.
export class CheckTransferIn extends TransferInAction { static operation = 'transfer-in.check'; static changes = undefined; run({ lifecycle }) { return lifecycle.check(this.actor, this.input); } }
export class ReserveTransferIn extends TransferInAction { static operation = 'transfer-in.reserve'; run({ lifecycle }) { return lifecycle.reserve(this.actor, this.input); } }
export const TRANSFER_IN_INTAKE_OPERATIONS = Object.freeze([CheckTransferIn, ReserveTransferIn]);
export { SuccessionError };
