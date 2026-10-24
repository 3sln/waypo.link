// Redirect management for a moved identity (docs/architecture/identity-portability.md §6.4 "Changing or ending a
// redirect"; spec §10 "Ending early", IP-R1-L3, §11 "Applications"). Engine-first: `RedirectManagementService` is the
// provider resource (catalogued as `redirectManagement`); the Actions at the end are its operations; HTTP
// (packages/runtime/routes/transfer-pages.mjs) and the Bindle sign-in (packages/runtime/redirect-management.mjs) are
// adapters.
//
// The moved identity signs in at 3sln.me *as an app user of its current provider*: 3sln.me is a Bindle client there
// (the SDK's BindleClient, server side, behind the `signin` port), and the token response it redeems itself names the
// signed-in identity (`issuer`, `subject`; optionally `bindle_origin`/`bindle_moves`, spec §11). That identity is
// accepted as the moved identity only when its successor chain verifies from this provider's own moved record:
//   1. the current host's identity document (`subject`) carries `moves`; `bindle_moves`, when present, must equal them
//      byte for byte and `bindle_origin` must name the chain's origin principal;
//   2. the account whose id is the document's `sub` is moved here and its redirect is live; anything else answers the
//      uniform not-found (U404, packages/runtime/public-unknown.mjs), never which of those it was;
//   3. FORKS: the chain record at this provider's position (`seq` of our statement) is byte-identical to our own
//      statement and attestation, and agrees with an earlier retarget's head;
//   4. STALE: the chain ends exactly at the signed-in identity (`to` = {issuer, subject}); the current host's directory
//      names it and its document ends with that record (spec §8.3 item 4); a chain shorter than an earlier retarget is
//      refused;
//   5. every later record passes spec §8.3 items 1–3 and 5 (packages/identity/successors.mjs `verifyRecords`): signed
//      by a key continuity-linked from the key that signed our statement, attested by its source under the §5.1 pins
//      (the destination's keys captured at our commit are preconfigured roots, so the first hop is not first use), and
//      its source has let go. Unattested records are never accepted here (no pending successors on this path).
// Then:
//   - end: the redirect stops at once (packages/identity/redirect-records.mjs `endRedirect`); no refund is made;
//   - retarget: only to a later host (a record after ours), at a `redirect_base` on exactly that host's origin which
//     the identity supplied in this authenticated transaction (never from a notice), never this provider's own origin,
//     and never when verifying the chain had to trust an attestation key on first use (spec §8.6 residual, §11 SHOULD).
// Both are idempotent (repeating them is a no-op answering the same outcome) and leave an address-free audit entry on
// the tombstone. Flag: none of its own; continuation of an existing move, it follows the IDENTITY_TRANSFER_OUT_ENABLED
// env kill switch (`background`), checked by the adapter.
import { AppAction } from '../app/engine.mjs';
import { AppFault } from '../app/faults.mjs';
import { isUUID } from '../core/primitives.mjs';
import { SuccessorRegistry, PortabilityUnavailable } from './successors.mjs';
import { parseMoveStatement, statementDigest, validateRedirectBase, httpsOrigin, evaluateAttestationKeys, verifyMoveRecordLink, verifyMoveStatement } from './succession.mjs';
import { revivable, REDIRECT_TIMING } from './redirect-records.mjs';
import { movedWindow } from './lifecycle-tombstone.mjs';

export const MANAGE_ACTIONS = Object.freeze(['end', 'retarget']);
const fail = (code, message, status = 400) => { throw new AppFault(code, message, status); };
/** The uniform answer for unknown, not-moved, expired, ended and unverifiable identities alike. */
const unknown = () => fail('not_found', 'Not found.', 404);
const unavailable = () => fail('temporarily_unavailable', 'The identity provider could not be reached. Try again later.', 503);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameRecord = (a, b) => a?.statement === b?.statement && a?.attestation === b?.attestation;

/** A transactional in-memory store for attestation pins when no durable one is configured (every issuer without a
 * preconfigured root is then first use, which retarget refuses). */
export function ephemeralStore() {
  const rows = new Map(); let tail = Promise.resolve();
  const tx = { get: async name => structuredClone(rows.get(name)), set: async (name, value) => { rows.set(name, structuredClone(value)); }, delete: async name => { rows.delete(name); }, list: async prefix => [...rows].filter(([name]) => name.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) };
  return { transaction(work) { const run = tail.then(() => work(tx)); tail = run.catch(() => {}); return run; } };
}

/** TransferOutPorts `destinationKeys` (packages/identity/transfer-out.mjs commit): the destination's currently listed
 * attestation keys that are roots or chain to a listed key, as thumbprints, fetched while it is posting the statement.
 * They become preconfigured roots for that issuer when a later retarget is verified. Null when unavailable. */
export function destinationKeysPort(client) {
  return async origin => {
    try { const keys = await client.attestationKeys(origin); if (!keys?.jwks) return null; const evaluated = await evaluateAttestationKeys({ issuer: origin, jwks: keys.jwks }); return evaluated.reset ? null : evaluated.trusted; }
    catch { return null; }
  };
}

export class RedirectManagementService {
  /** `records`: redirectRecordsPort. `client`: portabilityClient. `signin`: {begin({identity, intent}) -> {authorizationUrl,
   * transaction}, complete({transaction, callback}) -> {token, intent}}. `roots`: configured attestation roots
   * (issuer -> thumbprints). `store`: durable attestation-pin store, or null (ephemeral). `due`: {put(owner, at, kind)}. */
  constructor({ records, client, signin, issuer, roots = {}, store = null, due = null, clock = () => Date.now(), log = () => {}, crypto: webCrypto = globalThis.crypto }) {
    if (!records || !client || !signin || !httpsOrigin(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(issuer ?? '')) throw new TypeError('Redirect management dependencies are required.');
    Object.assign(this, { records, client, signin, issuer, roots, store, due, clock, log, crypto: webCrypto });
  }

  /** Starts the sign-in at the identity's current provider. `input`: {identity: 'handle@host', action, redirectBase?}.
   * Learns nothing about any moved identity (it is not known yet), so it is no oracle. */
  async begin(input) {
    if (!plain(input) || Object.keys(input).some(name => !['identity', 'action', 'redirectBase'].includes(name))) fail('invalid_request', 'Unsupported request.');
    const { identity, action, redirectBase } = input;
    if (typeof identity !== 'string' || identity.length > 320 || !identity.includes('@')) fail('invalid_identity', 'Enter your current handle, like alex@provider.example.');
    if (!MANAGE_ACTIONS.includes(action)) fail('invalid_request', 'Choose whether to end or retarget the redirect.');
    if (action === 'retarget' && (typeof redirectBase !== 'string' || redirectBase.length > 2048)) fail('redirect_invalid', 'Enter the redirect address your current provider gave you.');
    if (action === 'end' && redirectBase !== undefined) fail('invalid_request', 'Unsupported request.');
    let started; try { started = await this.signin.begin({ identity, intent: { action, ...action === 'retarget' ? { redirectBase } : {} } }); }
    catch (error) { if (error instanceof AppFault) throw error; fail('sign_in_unavailable', 'That provider cannot sign you in here. Check the handle and try again.', 400); }
    return { authorizationUrl: started.authorizationUrl, transaction: started.transaction };
  }

  /** Completes the sign-in and applies the action bound into the transaction at begin. */
  async complete(input) {
    if (!plain(input) || Object.keys(input).some(name => !['transaction', 'callback'].includes(name)) || typeof input.transaction !== 'string' || typeof input.callback !== 'string') fail('invalid_request', 'Unsupported request.');
    let signed; try { signed = await this.signin.complete({ transaction: input.transaction, callback: input.callback }); }
    catch (error) { if (error instanceof AppFault) throw error; this.log({ action: 'redirect-manage-refused', reason: 'sign-in' }); fail('sign_in_failed', 'Signing in did not complete. Start again.', 400); }
    const intent = signed?.intent; if (!plain(intent) || !MANAGE_ACTIONS.includes(intent.action)) fail('sign_in_failed', 'Signing in did not complete. Start again.', 400);
    const verified = await this.verify(signed.token, { action: intent.action });
    if (verified.contested) return this.contest(verified);
    return intent.action === 'end' ? this.end(verified) : this.retarget(verified, intent.redirectBase);
  }

  /** Steps 1–5 of the header. `action` picks the proof (review M3): `end` needs only the signature proof (our record at
   * its position, every later statement signed under keys continuity-linked from our signer as the signed-in host lists
   * them, the chain ending at the signed-in identity); intermediate attestation and let-go failures are tolerated because
   * ending fails safe. `retarget` needs full spec §8.3 verification. Both detect equivocation against a recorded retarget
   * (review M1): a presented record that differs from the recorded chain after a common prefix (so from the same source)
   * and is validly attested by that source is evidence (spec §8.4); the caller then ends the redirect as `contested`.
   * Returns the verified facts or answers the uniform not-found / unavailable. */
  async verify(token, { action = 'retarget' } = {}) {
    const refuse = reason => { this.log({ action: 'redirect-manage-refused', reason }); unknown(); };
    if (!plain(token) || !httpsOrigin(token.issuer) || typeof token.subject !== 'string') return refuse('token');
    let subject; try { subject = new URL(token.subject); } catch { return refuse('token'); }
    if (subject.origin !== token.issuer || subject.href !== token.subject || subject.search || subject.hash) return refuse('token');
    if (token.issuer === this.issuer) return refuse('own-issuer');
    try {
      // 1. The signed-in identity's own document and its chain.
      const doc = await this.client.document(token.subject);
      if (doc.status !== 'ok' || !Array.isArray(doc.document.moves)) return refuse('document');
      const sub = doc.document.sub, moves = doc.document.moves;
      if (token.bindle_moves !== undefined && (!Array.isArray(token.bindle_moves) || token.bindle_moves.length !== moves.length || token.bindle_moves.some((record, i) => !sameRecord(record, moves[i])))) return refuse('token-moves');
      const registry = await this.registry(sub);
      const chain = registry.parse(moves); if (!chain) return refuse('chain');
      if (token.bindle_origin !== undefined && (!plain(token.bindle_origin) || token.bindle_origin.sub !== sub || token.bindle_origin.iss !== chain[0].parsed.payload.from.iss)) return refuse('token-origin');
      // 2. Our own moved record: live, or (retarget only) an owner end the verified owner may revive (review L4).
      const account = isUUID(sub) ? await this.records.get(sub) : null, moved = account?.status === 'moved' ? account.moved : null, now = this.clock();
      if (!plain(moved) || typeof moved.statement !== 'string') return refuse('not-live');
      const live = movedWindow(moved, now).live;
      if (!live && !(action === 'retarget' && revivable(moved, now))) return refuse('not-live');
      const own = parseMoveStatement(moved.statement), seq = own.payload.seq;
      // 3. Forks at our position are never accepted, for any action.
      if (!sameRecord(moves[seq - 1], { statement: moved.statement, attestation: moved.attestation })) return refuse('forked');
      const later = chain.slice(seq), last = later.at(-1)?.parsed.payload ?? own.payload;
      // 4. Stale: the chain ends at the signed-in identity, which its host's directory and document confirm.
      if (last.to.iss !== token.issuer || last.to.identity !== token.subject || chain.at(-1).parsed.payload.seq !== chain.length) return refuse('stale');
      const dest = await registry.destination(last.to, sub);
      if (dest.fail) return refuse(dest.fail === 'destination-moved' ? 'stale' : dest.fail);
      if ((dest.document.moves ?? []).length !== chain.length || dest.document.moves.some((record, i) => !sameRecord(record, moves[i]))) return refuse('stale');
      // 5a. Signature proof: every later statement under a key continuity-linked from the key that signed ours.
      const floor = dest.lineage.findIndex(entry => entry.kid === own.header.kid);
      if (floor < 0) return refuse('key-unlinked');
      // The key the host lists under our signer's kid must be the key that actually signed our statement (a kid alone is
      // a name anyone can reuse; review follow-up).
      try { await verifyMoveStatement(moved.statement, dest.lineage[floor].publicJwk, { crypto: this.crypto }); } catch { return refuse('key-unlinked'); }
      if (!await this.signatures(later, own, dest.lineage, floor, sub)) return refuse('chain');
      const digests = await Promise.all(later.map(record => statementDigest(record.parsed.input, { crypto: this.crypto })));
      const base = { sub, expect: moved.statementDigest, seq, headSeq: chain.length, head: digests.at(-1) ?? null, digests, current: { iss: last.to.iss, identity: last.to.identity }, later: later.length, live };
      // 5b. The presented chain must extend what this provider already proved (review R2-1/R2-2): a recorded retarget's
      // chain while live, the ender's proved chain for a revival. Divergence whose record is attested under rooted or
      // pinned keys (never first use, R2-3) is spec §8.4 equivocation evidence -> contested; any other divergence, or a
      // shorter chain, is refused, for every action.
      const recorded = live ? moved.retarget : moved.endedProof;
      const divergence = this.divergence(recorded, digests, seq);
      if (divergence !== null) {
        const evidence = await this.rootedAttestation(registry, later[divergence]);
        if (evidence) return { ...base, contested: { seq: later[divergence].parsed.payload.seq, recorded: Array.isArray(recorded.digests) ? recorded.digests[divergence] : recorded.head, presented: digests[divergence] } };
        return refuse('forked');
      }
      if (recorded && chain.length < recorded.seq) return refuse('stale');
      if (action === 'end') return { ...base, proof: 'signature', keys: await this.provedKeys(registry, later) };
      // 5c. Full proof for a retarget: spec §8.3 items 1–3 and 5 for every later record.
      const checked = await registry.verifyRecords({ records: later, previous: own, current: own.payload.to, lineage: dest.lineage, floor, sub, kind: own.payload.kind });
      if (!checked.ok) return refuse(checked.reason ?? 'chain');
      return { ...base, proof: 'full', firstUse: checked.firstUse === true, keys: checked.firstUse === true ? {} : await this.provedKeys(registry, later) };
    } catch (error) {
      if (error instanceof PortabilityUnavailable) unavailable();
      if (error instanceof AppFault) throw error;
      return refuse('chain');
    }
  }
  /** R2-3: the record's attestation verified under a key that is a preconfigured root for its source or chains to a pin
   * that was not made on first use; {issuer, thumbprint} or null. */
  async rootedAttestation(registry, record) {
    const s = record.parsed.payload; if (record.attestation === null) return null;
    let checked; try { checked = await registry.pins.check(s.from.iss, record.attestation, record.parsed, { fresh: true }); } catch (error) { if (error instanceof PortabilityUnavailable) throw error; return null; }
    if (!checked.ok || checked.firstUse) return null;
    const rooted = (registry.roots[s.from.iss] ?? []).includes(checked.thumbprint), pin = await registry.pins.read(s.from.iss);
    return rooted || pin?.firstUse === false ? { issuer: s.from.iss, thumbprint: checked.thumbprint } : null;
  }
  /** Rooted/pinned attestation keys of the later records (issuer -> thumbprints), stored with a retarget or an end so
   * that later equivocation checks have pins (R2-3). Best effort; address-free apart from issuer origins, which are
   * deleted with the record's addresses. */
  async provedKeys(registry, later) {
    const keys = {};
    for (const record of later) { const found = await this.rootedAttestation(registry, record).catch(() => null); if (found) keys[found.issuer] = [...new Set([...(keys[found.issuer] ?? []), found.thumbprint])]; }
    return keys;
  }
  /** Offline: link, subject, kind and signature of each later record, keys non-decreasing in the host's lineage. */
  async signatures(later, own, lineage, floor, sub) {
    const index = new Map(lineage.map((entry, i) => [entry.kid, i])); let prev = own, low = floor;
    for (const record of later) {
      try { await verifyMoveRecordLink(prev, record.parsed, { crypto: this.crypto }); } catch { return false; }
      if (record.parsed.payload.sub !== sub || record.parsed.payload.kind !== own.payload.kind) return false;
      const position = index.get(record.parsed.header.kid); if (position === undefined || position < low) return false;
      try { await verifyMoveStatement(record.parsed.value, lineage[position].publicJwk, { crypto: this.crypto }); } catch { return false; }
      low = position; prev = record.parsed;
    }
    return true;
  }
  /** Index (into `later`) of the first position where the presented chain differs from a recorded retarget, or null. */
  divergence(recorded, digests, seq) {
    if (!recorded) return null;
    if (Array.isArray(recorded.digests)) { for (let i = 0; i < Math.min(recorded.digests.length, digests.length); i++) if (recorded.digests[i] !== digests[i]) return i; return null; }
    const at = recorded.seq - seq - 1; return at >= 0 && at < digests.length && digests[at] !== recorded.head ? at : null;
  }
  /** A verifier over the configured pin store, with the destination keys captured at our commit as roots. */
  async registry(sub) {
    const account = isUUID(sub) ? await this.records.get(sub) : null, moved = account?.status === 'moved' ? account.moved : null;
    const roots = { ...this.roots };
    let destination = null; try { destination = parseMoveStatement(moved.statement).payload.to.iss; } catch { destination = null; }
    if (Array.isArray(moved?.destinationKeys) && httpsOrigin(destination)) roots[destination] = [...new Set([...(roots[destination] ?? []), ...moved.destinationKeys])];
    for (const proved of [moved?.retarget?.keys, moved?.endedProof?.keys]) if (plain(proved)) for (const [issuer, list] of Object.entries(proved)) if (httpsOrigin(issuer) && Array.isArray(list)) roots[issuer] = [...new Set([...(roots[issuer] ?? []), ...list.filter(value => typeof value === 'string')])];
    const registry = new SuccessorRegistry({ store: this.store ?? ephemeralStore(), client: this.client, enabled: () => true, roots, clock: this.clock, log: this.log, crypto: this.crypto });
    registry.roots = roots; return registry;
  }

  /** Review M1: equivocation evidence ends the redirect as `contested` (never revivable here; support decides). */
  async contest(verified) {
    const result = verified.live ? await this.records.end(verified.sub, { expect: verified.expect, seq: verified.headSeq, by: 'contested', evidence: verified.contested }) : await this.records.contest(verified.sub, { expect: verified.expect, evidence: verified.contested });
    if (!result.ok) { if (result.status === 'conflict') unavailable(); unknown(); }
    if (result.changed) { const until = result.account?.moved?.movedUntil; try { if (Number.isSafeInteger(until)) await this.due?.put?.(verified.sub, until, 'moved-end'); } catch {} this.log({ action: 'redirect-contested', seq: verified.contested.seq }); }
    return { outcome: 'ended', contested: true };
  }
  async end(verified) {
    const result = await this.records.end(verified.sub, { expect: verified.expect, seq: verified.headSeq, proof: verified.proof ?? null, proved: { seq: verified.headSeq, digests: verified.digests ?? [] } });
    if (!result.ok) { if (result.status === 'conflict') unavailable(); unknown(); }
    // A redirect that had already stopped (a concurrent end or expiry) answers the same: the outcome holds.
    if (result.changed) { const until = result.account?.moved?.movedUntil; try { if (Number.isSafeInteger(until)) await this.due?.put?.(verified.sub, until, 'moved-end'); } catch { /* the existing row ends it later */ } this.log({ action: 'redirect-ended', by: 'owner' }); }
    return { outcome: 'ended' };
  }
  async retarget(verified, redirectBase) {
    if (verified.later < 1) fail('retarget_unavailable', 'Your identity has not moved again since it left this provider, so there is no later host to redirect to.', 409);
    if (verified.firstUse) fail('retarget_unverified', 'The move to your current provider could not be confirmed against keys this provider already knew, so the redirect cannot be changed to it. You can still end the redirect.', 409);
    if (verified.current.iss === this.issuer) fail('retarget_unavailable', 'A redirect cannot point back to this provider.', 409);
    try { validateRedirectBase(redirectBase, verified.current.iss); } catch { fail('redirect_invalid', 'The redirect address must be on your current provider and end with /.', 400); }
    const result = await this.records.retarget(verified.sub, { expect: verified.expect, to: verified.current, redirectBase, seq: verified.headSeq, head: verified.head, digests: verified.digests, keys: verified.keys ?? {} });
    if (!result.ok) { if (result.status === 'conflict') unavailable(); if (['stale', 'forked'].includes(result.status)) { this.log({ action: 'redirect-manage-refused', reason: result.status }); } unknown(); }
    if (result.changed) { this.log({ action: result.revived ? 'redirect-revived' : 'redirect-retargeted', by: 'owner' }); const until = result.account?.moved?.movedUntil; if (result.revived && Number.isSafeInteger(until)) { try { await this.due?.put?.(verified.sub, until, 'moved-end'); await this.due?.put?.(verified.sub, this.clock() + REDIRECT_TIMING.probeEvery, 'moved-probe'); } catch {} } }
    return { outcome: 'retargeted', host: verified.current.iss, ...result.revived ? { revived: true } : {} };
  }
}

// ---- engine operations ----------------------------------------------------------------------------------------
// Public actors only: the caller is not signed in at 3sln.me; the Bindle sign-in at the current host is the proof.
// Constructed as `new BeginRedirectManagement({actor: {kind: 'public'}, input})`.
class ManagementAction extends AppAction { static deps = ['redirectManagement']; static termsGate = 'exempt'; }
export class BeginRedirectManagement extends ManagementAction { run({ redirectManagement }) { return redirectManagement.begin(this.input); } }
export class CompleteRedirectManagement extends ManagementAction { run({ redirectManagement }) { return redirectManagement.complete(this.input); } }
