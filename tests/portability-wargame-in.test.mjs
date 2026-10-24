// Portability wargame regressions, destination and verifier half (DEVLOG 2026-10-23, F6–F10). Each test fails when
// its fix is reverted. Seeded chaos for the successor queue: rerun a failing seed with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { metadataStore } from '../packages/app/memory-providers.mjs';
import { fakeClock, forEachSeed } from './helpers/chaos.mjs';
import { World, json } from './helpers/portability-network.mjs';
import { portabilityPair, packageFrom, ISSUER, OWNER, DEST, DAY, HOUR } from './helpers/transfer-in.mjs';
import { keyPair } from './helpers/transfer-out.mjs';
import { SuccessorRegistry, portabilityClient, QUEUE_POLICY } from '../packages/identity/successors.mjs';
import { TRANSFER_IN_TIMING } from '../packages/identity/transfer-in.mjs';
import { signMoveStatement, statementDigest, parseMoveStatement } from '../packages/identity/succession.mjs';

const registry = (t, world, clock, log = () => {}) => { const db = new SqliteMetadata(':memory:'); t.after(() => db.close()); return new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: world.net.fetch, clock: clock.now }), enabled: () => true, clock: clock.now, log }); };
const queued = v => v.store.transaction(tx => tx.list('successor-queue/'));

// ---- F6: letGo counts a different identity URI as a return only when a later record moves there ----

test('F6: a forged chain with a fabricated from.identity does not pass item 5 while the source still serves the identity', async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 22, 12)), world = new World({ clock });
  const S = await world.provider('https://s.example'), M = await world.provider('https://m.example');
  const id = await world.identity(); world.host(S, id);
  const old = id.current, bogusFrom = { iss: S.origin, identity: `${S.origin}/identity/${id.sub}/r9` }, to = { iss: M.origin, identity: `${M.origin}/identity/${id.sub}` };
  const statement = await signMoveStatement({ kid: old.kid, payload: { bindle: 'identity-move', v: 1, sub: id.sub, kind: 'person', seq: 1, prev: null, from: bogusFrom, to, iat: 1790000000 } }, old.pair.privateKey);
  const attestation = await S.attest({ bindle: 'move-attestation', v: 1, iss: S.origin, sub: id.sub, seq: 1, statement: await statementDigest(parseMoveStatement(statement).input), to, aep: 3, at: 1790000010 });
  const keys = id.documentKeys();
  M.state.set(id.sub, { status: 'active', identity: to.identity, document: () => ({ v: 1, iss: M.origin, sub: id.sub, kind: 'person', keys, moves: [{ statement, attestation }] }) });
  const out = await registry(t, world, clock).firstContact({ iss: M.origin, sub: id.sub, purpose: 'origin-linking' });
  assert.notEqual(out.outcome, 'verified', `fork verified as origin ${JSON.stringify(out.origin)} while ${S.origin} still serves ${id.sub}`);
  assert.equal(out.reason, 'source-active');
});

test('F6: a genuine return (S -> M -> S) still counts the first move as let go', async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 22, 12)), world = new World({ clock });
  const S = await world.provider('https://s.example'), M = await world.provider('https://m.example');
  const id = await world.identity(); world.host(S, id);
  const v = registry(t, world, clock), origin = { iss: S.origin, sub: id.sub };
  await v.track({ origin, identity: S.state.get(id.sub).identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
  await world.move(id, S, M); await world.move(id, M, S);
  const back = S.state.get(id.sub);
  const adopted = await v.adopt(origin, back.document().moves);
  assert.equal(adopted.outcome, 'adopted', JSON.stringify(adopted));
  assert.equal((await v.pin(origin)).head.seq, 2);
});

// ---- F7: "still serving" is tracked apart from "declares portability.v1" ----

async function forkedWhileServing(t) {
  const clock = fakeClock(Date.UTC(2026, 9, 22, 12)), world = new World({ clock });
  const A = await world.provider('https://a.example', { portability: false }), B = await world.provider('https://b.example');
  const id = await world.identity(); world.host(A, id);
  const v = registry(t, world, clock), origin = { iss: A.origin, sub: id.sub };
  await v.track({ origin, identity: A.state.get(id.sub).identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
  const fork = await world.move(id, A, B, { attest: false, keepSource: true });
  return { v, origin, fork, A, id };
}

test('F7: a pending successor is not adopted silently while a non-portability pinned host still serves the identity', async t => {
  const { v, origin, fork } = await forkedWhileServing(t);
  const offered = await v.adopt(origin, [fork]);
  assert.equal(offered.outcome, 'pending'); assert.equal(offered.oldHostServing, true);
  const [shown] = await v.pending(origin);
  assert.equal(shown.oldHostServing, true, 'pending() surfaces that the old host still serves the identity');
  const unconfirmed = await v.confirm(origin, { digest: offered.digest });
  assert.equal(unconfirmed.outcome, 'confirmation-required');
  assert.equal((await v.pin(origin)).head.seq, 0);
  const confirmed = await v.confirm(origin, { digest: offered.digest, acknowledgeSourceActive: true });
  assert.equal(confirmed.outcome, 'adopted');
});

test('F7: a pending row learns at confirm time that the old host serves again, so the warning is shown before adoption', async t => {
  const { v, origin, fork, A, id } = await forkedWhileServing(t);
  const entry = A.state.get(id.sub); A.state.delete(id.sub);
  const offered = await v.adopt(origin, [fork]);
  assert.equal(offered.outcome, 'pending'); assert.equal((await v.pending(origin))[0].oldHostServing, false);
  A.state.set(id.sub, entry);
  assert.equal((await v.confirm(origin, { digest: offered.digest })).outcome, 'confirmation-required');
  assert.equal((await v.pending(origin))[0].oldHostServing, true);
});

// ---- F8: the presented-chain queue cannot be wedged ----

const forgedFrom = async (key, toIss, iat, kid = 'x') => ({ statement: await signMoveStatement({ kid, payload: { bindle: 'identity-move', v: 1, sub: OWNER, kind: 'person', seq: 1, prev: null, from: { iss: ISSUER, identity: `${ISSUER}/identity/${OWNER}` }, to: { iss: toIss, identity: `${toIss}/identity/${OWNER}` }, iat } }, key.privateKey), attestation: null });

test('F8: forged presentations to unreachable hosts do not starve a later presentation', async t => {
  const p = await portabilityPair(t, { start: false }), v = p.verifier();
  await v.track({ origin: { iss: ISSUER, sub: OWNER }, identity: `${ISSUER}/identity/${OWNER}`, signing: { kid: 'kid-1', publicJwk: p.source.signing.publicJwk } });
  const junk = await keyPair();
  for (let i = 0; i < 16; i++) await v.present({ moves: [await forgedFrom(junk, `https://blackhole${i}.example`, 1800000000 + i)] });
  assert.ok((await queued(v)).length <= QUEUE_POLICY.perOrigin, 'at most perOrigin rows per origin');
  p.clock.advance(1000);
  const later = await forgedFrom(junk, DEST, 1900000000);
  await v.present({ moves: [later] });
  const id = `${ISSUER}|${OWNER}|${await statementDigest(parseMoveStatement(later.statement).input)}`;
  assert.ok((await queued(v)).some(row => row.value.id === id), 'a new presentation evicts the most-tried, oldest row of its origin');
  for (let i = 0; i < 10; i++) { p.clock.advance(HOUR); await v.drain(); }
  const left = await queued(v);
  assert.ok(!left.some(row => row.value.id === id), 'the later presentation was processed');
  assert.ok(left.length <= 16 && left.every(row => row.value.attempts < QUEUE_POLICY.attempts));
});

test('F8: offline checks drop chains signed under the pinned kid by another key, unlinked chains and other subjects; unreachable rows back off and drop', async t => {
  const p = await portabilityPair(t, { start: false }), v = p.verifier();
  await v.track({ origin: { iss: ISSUER, sub: OWNER }, identity: `${ISSUER}/identity/${OWNER}`, signing: { kid: 'kid-1', publicJwk: p.source.signing.publicJwk } });
  const junk = await keyPair();
  await v.present({ moves: [await forgedFrom(junk, 'https://blackhole.example', 1800000000, 'kid-1')] }); // the pinned kid, the wrong key
  const wrongFrom = { statement: await signMoveStatement({ kid: 'x', payload: { bindle: 'identity-move', v: 1, sub: OWNER, kind: 'person', seq: 1, prev: null, from: { iss: ISSUER, identity: `${ISSUER}/identity/${OWNER}/r2` }, to: { iss: 'https://blackhole.example', identity: `https://blackhole.example/identity/${OWNER}` }, iat: 1800000001 } }, junk.privateKey), attestation: null };
  await v.present({ moves: [wrongFrom] });
  const gap = { statement: await signMoveStatement({ kid: 'x', payload: { bindle: 'identity-move', v: 1, sub: OWNER, kind: 'person', seq: 2, prev: 'sha256-' + 'A'.repeat(43), from: { iss: 'https://m.example', identity: `https://m.example/identity/${OWNER}` }, to: { iss: 'https://blackhole.example', identity: `https://blackhole.example/identity/${OWNER}` }, iat: 1800000002 } }, junk.privateKey), attestation: null };
  await v.present({ moves: [gap] });
  assert.equal((await queued(v)).length, 0, 'nothing that fails offline occupies the queue');
  // The genuine pinned key passes offline; the destination is unreachable, so the row backs off and is dropped.
  const genuine = await forgedFrom(p.source.signing, 'https://blackhole.example', 1800000003, 'kid-1');
  await v.present({ moves: [genuine] });
  assert.equal((await queued(v)).length, 1);
  await v.drain(); let [row] = await queued(v);
  assert.equal(row.value.attempts, 1); assert.ok(row.value.nextAt > p.clock.now());
  assert.equal((await v.drain()).processed, 0, 'a backed-off row is not retried before nextAt');
  for (let i = 0; i < QUEUE_POLICY.attempts + 2; i++) { p.clock.advance(QUEUE_POLICY.max); await v.drain(); }
  assert.equal((await queued(v)).length, 0, 'dropped after the attempt bound');
});

test('F8 chaos: queue rows stay bounded per origin, back off, drop, and a genuine presentation is always processed once the network heals', async t => {
  let genuineAdopted = 0;
  await forEachSeed(Number(process.env.CHAOS_SEEDS ?? 6), async random => {
    const clock = fakeClock(Date.UTC(2026, 9, 22, 12)), world = new World({ clock });
    const A = await world.provider('https://a.example'), B = await world.provider('https://b.example'), C = await world.provider('https://c.example');
    const id = await world.identity(); world.host(A, id);
    const db = new SqliteMetadata(':memory:');
    try {
      const v = new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: world.net.fetch, clock: clock.now }), enabled: () => true, clock: clock.now });
      const origin = { iss: A.origin, sub: id.sub }, firstKid = id.current.kid, firstKey = id.current.pair;
      await v.track({ origin, identity: A.state.get(id.sub).identity, signing: { kid: firstKid, publicJwk: firstKey.publicJwk } });
      const junk = await keyPair(); let moved = false, n = 0;
      const forged = async (kid, key) => ({ statement: await signMoveStatement({ kid, payload: { bindle: 'identity-move', v: 1, sub: id.sub, kind: 'person', seq: 1, prev: null, from: { iss: A.origin, identity: A.state.get(id.sub).identity }, to: { iss: `https://hole${n}.example`, identity: `https://hole${n++}.example/identity/${id.sub}` }, iat: 1800000000 + n } }, key.privateKey), attestation: null });
      const ops = [
        [6, async () => v.present({ moves: [await forged('x', junk)] })],
        [2, async () => { await v.present({ moves: [await forged(firstKid, junk)] }); }],
        [1, async () => { if (moved) return; await world.move(id, A, random.pick([B, C])); moved = true; }],
        [3, async () => { if (moved) { const host = [B, C].find(h => h.state.get(id.sub)?.status === 'active'); await v.present({ moves: host.state.get(id.sub).moves }); } }],
        [4, async () => v.drain()],
        [2, async () => { const host = random.pick([A, B, C]); if (random.chance(0.5)) world.net.down.add(host.origin); else world.net.down.delete(host.origin); }],
        [4, async () => clock.advance(random.pick([5 * 60000, HOUR, 6 * HOUR, DAY]))],
      ];
      const total = ops.reduce((sum, [w]) => sum + w, 0), pick = () => { let x = random.next() * total; for (const [w, fn] of ops) if ((x -= w) < 0) return fn; return ops.at(-1)[1]; };
      const check = async () => {
        const rows = await queued(v);
        assert.ok(rows.length <= QUEUE_POLICY.perOrigin, `queue holds ${rows.length} rows for one origin`);
        for (const row of rows) {
          assert.ok(row.value.attempts < QUEUE_POLICY.attempts, 'a row past the attempt bound was kept');
          const parsed = parseMoveStatement(row.value.moves.at(-1).statement);
          assert.ok(!(parsed.header.kid === firstKid && parsed.payload.to.iss.startsWith('https://hole')), 'a chain under the pinned kid with the wrong key was queued');
        }
      };
      for (let i = 0; i < 40; i++) { await pick()(); await check(); }
      // Heal: the genuine chain (if any) is presented once more and must be adopted within bounded drains.
      world.net.down.clear();
      if (!moved) await world.move(id, A, B);
      const host = [B, C].find(h => h.state.get(id.sub)?.status === 'active');
      await v.present({ moves: host.state.get(id.sub).moves });
      for (let i = 0; i < 40 && (await v.pin(origin)).head.seq === 0; i++) { clock.advance(QUEUE_POLICY.max); await v.drain(); await check(); }
      assert.equal((await v.pin(origin)).head.seq, 1, 'the genuine move was adopted from the queue');
      genuineAdopted++;
    } finally { db.close(); }
  });
  assert.ok(genuineAdopted > 0);
});

// ---- F9: abandoned transfer-in reservations ----

test('F9: the owner cancel releases a reservation that has no transfer-in record, so a fresh package can reserve', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  await dest.reserve(p.pkg);
  assert.equal((await dest.identityRecord()).status, 'pending-transfer');
  await source.cancel();
  p.clock.advance(60 * DAY);
  Object.assign(source.signing, await keyPair()); source.state.currentKid = 'kid-2';
  await source.patchIdentity(a => ({ ...a, recoveryKeyKid: 'kid-2', security: { epoch: a.security.epoch, changedAt: p.clock.now() - 20 * DAY } }));
  await dest.step();
  const cancelled = await dest.cancel();
  assert.equal(cancelled.reservationReleased, true);
  assert.equal((await dest.identityRecord()).status, 'transfer-released');
  await source.start(); const fresh = packageFrom(source, await source.get());
  const reserved = await dest.reserve(fresh).catch(e => ({ error: e.code ?? e.message }));
  assert.equal(reserved.error, undefined, JSON.stringify(reserved));
});

test('F9: an unbegun reservation expires after its TTL; a begun one does not', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  await dest.reserve(p.pkg);
  await source.cancel();
  Object.assign(source.signing, await keyPair()); source.state.currentKid = 'kid-2';
  await source.patchIdentity(a => ({ ...a, recoveryKeyKid: 'kid-2', security: { epoch: a.security.epoch, changedAt: p.clock.now() - 20 * DAY } }));
  await source.start(); const fresh = packageFrom(source, await source.get());
  assert.equal((await dest.reserve(fresh).catch(e => ({ error: e.code }))).error, 'sub_in_use', 'inside the TTL the reservation holds');
  p.clock.advance(TRANSFER_IN_TIMING.reservationTtl);
  const reserved = await dest.reserve(fresh).catch(e => ({ error: e.code }));
  assert.equal(reserved.error, undefined, 'after the TTL a new package reserves');
  // Begun: the transfer-in record owns the reservation; the TTL no longer applies.
  await dest.begin(fresh);
  assert.ok((await dest.identityRecord()).transferIn.begunAt);
  p.clock.advance(2 * TRANSFER_IN_TIMING.reservationTtl);
  const other = packageFrom(source, await source.get(), { keys: { signing: { kid: 'kid-3', jwk: (await keyPair()).privateJwk } } });
  assert.notEqual((await dest.reserve(other).catch(e => ({ error: e.code }))).error, undefined);
});

// ---- F10: a held transfer-in ends after the source's idempotency window ----

test('F10: an unverifiable attestation does not hold the arriving identity forever; the give-up alerts operators', async t => {
  const p = await portabilityPair(t), { dest } = p;
  const junk = 'eyJhbGciOiJFUzI1NiJ9.e30.' + 'A'.repeat(86);
  p.served.extra = async request => request.path === '/move' ? json({ status: 'attested', attestation: junk, redirect_until: null }) : null;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  assert.equal((await dest.get()).state, 'held');
  assert.equal(await dest.cancel().catch(e => e.code), 'cancel_at_source', 'inside the window the owner cancels at the source');
  for (let i = 0; i < 12; i++) { p.clock.advance(30 * DAY); await dest.step(); }
  const record = await dest.get();
  assert.equal(record.state, 'failed'); assert.equal(record.reason, 'held-gave-up');
  assert.equal((await dest.identityRecord()).status, 'transfer-released');
  assert.ok(dest.logs.some(event => event.action === 'transfer-in-held-abandoned' && event.alert === true));
});

test('F10: the owner may abandon a held transfer-in only after the window', async t => {
  const p = await portabilityPair(t), { dest } = p;
  p.served.extra = async request => request.path === '/move' ? json({ status: 'attested', attestation: 'eyJhbGciOiJFUzI1NiJ9.e30.' + 'A'.repeat(86), redirect_until: null }) : null;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  p.clock.advance(TRANSFER_IN_TIMING.heldWarn); await dest.step();
  assert.ok(dest.logs.some(event => event.action === 'transfer-in-held-warning' && event.alert === true), 'operators are warned before the give-up');
  p.clock.advance(TRANSFER_IN_TIMING.heldGiveUp - TRANSFER_IN_TIMING.heldWarn - HOUR);
  assert.equal(await dest.cancel().catch(e => e.code), 'cancel_at_source');
  p.clock.advance(HOUR);
  const ended = await dest.cancel();
  assert.equal(ended.state, 'failed'); assert.equal(ended.reason, 'held-abandoned');
});

// ---- review follow-ups (2026-10-23) ----

test('follow-up 2: junk under a non-pinned kid never evicts a verified row; unverified rows are capped per origin; a full queue evicts from the largest origin', async t => {
  const p = await portabilityPair(t, { start: false }), v = p.verifier();
  await v.track({ origin: { iss: ISSUER, sub: OWNER }, identity: `${ISSUER}/identity/${OWNER}`, signing: { kid: 'kid-1', publicJwk: p.source.signing.publicJwk } });
  const genuine = await forgedFrom(p.source.signing, 'https://dest-real.example', 1800000000, 'kid-1');
  await v.present({ moves: [genuine] });
  const junk = await keyPair();
  for (let i = 0; i < 12; i++) { p.clock.advance(1000); await v.present({ moves: [await forgedFrom(junk, `https://junk${i}.example`, 1800000100 + i)] }); }
  let rows = await queued(v);
  assert.equal(rows.filter(row => row.value.verified === true).length, 1, 'the verified row survives');
  assert.ok(rows.filter(row => row.value.verified !== true).length <= QUEUE_POLICY.perOriginUnverified);
  // Fill the queue with another origin's rows: a new row evicts from that origin instead of being dropped.
  await v.store.transaction(async tx => { for (let i = rows.length; i < 256; i++) await tx.set(`successor-queue/filler-${String(i).padStart(4, '0')}/`, { id: `filler-${i}`, origin: { iss: 'https://big.example', sub: OWNER }, moves: [], at: 1, nextAt: 1, attempts: 0, verified: false }); });
  const second = await forgedFrom(p.source.signing, 'https://dest-two.example', 1800000200, 'kid-1');
  await v.present({ moves: [second] });
  rows = await queued(v);
  const id = `${ISSUER}|${OWNER}|${await statementDigest(parseMoveStatement(second.statement).input)}`;
  assert.ok(rows.some(row => row.value.id === id), 'the new row was queued');
  assert.equal(rows.length, 256);
});

test('follow-up 3: begin claims the reservation before writing its record, so a lost race leaves no orphan record', async t => {
  const p = await portabilityPair(t), { dest } = p;
  await dest.reserve(p.pkg);
  const begun = dest.identity.begun;
  dest.ports.identity = { ...dest.identity, begun: async () => ({ ok: false, status: 'pending-transfer' }) };
  assert.equal(await dest.begin(p.pkg).catch(e => e.code), 'reservation_mismatch');
  assert.equal(await dest.get(), undefined, 'no transfer-in record was written');
  dest.ports.identity = { ...dest.identity, begun };
  assert.equal((await dest.begin(p.pkg)).state === 'refused', false);
});

test('follow-up 5: a legacy held record without heldSince is not abandoned on its next step; the warning precedes the give-up', async t => {
  const p = await portabilityPair(t), { dest } = p;
  p.served.extra = async request => request.path === '/move' ? json({ status: 'attested', attestation: 'eyJhbGciOiJFUzI1NiJ9.e30.' + 'A'.repeat(86), redirect_until: null }) : null;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  const record = await dest.get(); delete record.heldSince; await dest.metadata.put('transfer-in/v1', record);
  p.clock.advance(90 * DAY); await dest.step();
  const after = await dest.get();
  assert.equal(after.state, 'held'); assert.equal(after.heldSince, p.clock.now());
  // Steps that skip past the warning still give the operators the full gap before the give-up.
  p.clock.advance(TRANSFER_IN_TIMING.heldGiveUp + DAY); await dest.step();
  assert.equal((await dest.get()).state, 'held');
  assert.ok(dest.logs.some(event => event.action === 'transfer-in-held-warning'));
  p.clock.advance(TRANSFER_IN_TIMING.heldGiveUp - TRANSFER_IN_TIMING.heldWarn); await dest.step();
  assert.equal((await dest.get()).state, 'failed');
});
