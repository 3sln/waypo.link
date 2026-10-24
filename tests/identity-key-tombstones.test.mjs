// Key tombstone compaction, pinned-history accounting and chain protection in packages/identity/keys.mjs (DEVLOG
// 2026-10-23 "Successor chain byte budget and key tombstone compaction"; docs/spec/identity-portability.md §7, §7.1).
// Engine-level over the key registry engine: real keys, real continuity statements, seeded chaos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMessagingStore, key } from '../packages/core/records.mjs';
import { createIdentityKeyEngine, performKeyAction, readKeyQuery, RotateIdentityKey, RegisterIdentityKey, RevokeIdentityKey, IdentityKeyRetainedState, KEY_HISTORY_LIMIT, TOMBSTONE_PAGE, continuityChain } from '../packages/identity/keys.mjs';
import { documentLineage, MAX_STATEMENT_BYTES, MAX_ATTESTATION_BYTES, MAX_MOVES_DOCUMENT_BYTES, MOVE_KEY_ALLOWANCE, MAX_DOCUMENT_KEYS, DOCUMENT_BYTES } from '../packages/identity/succession.mjs';
import { identityDocument } from '../packages/identity/transfer-in.mjs';
import { signingKeysOf } from '../packages/identity/successors.mjs';
import { pair, continuity } from './helpers/portability-network.mjs';
import { fakeClock, forEachSeed } from './helpers/chaos.mjs';

const OWNER = '6f1c2b8e-3d4a-4c5b-9e7f-0a1b2c3d4e5f', ISSUER = 'https://dest.example';
const sealing = { seal: value => structuredClone(value), open: value => structuredClone(value) };
function fixture({ historyLimit } = {}) {
  const store = new MemoryMessagingStore(), clock = fakeClock(1800000000000);
  const engine = createIdentityKeyEngine({ store, ...sealing, clock: clock.now, ...historyLimit ? { historyLimit } : {} });
  const act = (Action, input) => performKeyAction(engine, new Action({ owner: OWNER, input }));
  const ask = Query => readKeyQuery(engine, new Query({ owner: OWNER, input: {} }));
  const rows = async prefix => (await store.transaction(tx => tx.list(prefix))).length;
  const rotate = async () => { const current = await engine.identityKeys.current(OWNER, { purpose: 'signing' }); clock.advance(1000); return act(RotateIdentityKey, { purpose: 'signing', expectedKid: current.kid }); };
  const signing = () => engine.identityKeys.history(OWNER, { purpose: 'signing' });
  return { store, clock, engine, keys: engine.identityKeys, act, ask, rows, rotate, signing };
}
const external = async kid => ({ kid, alg: 'ES256', publicJwk: (await pair()).publicJwk });

test('100 rotations keep 16 signing records and one tombstone page of 85 kids; every pruned kid stays unregistrable', async () => {
  const f = fixture(); await f.keys.ensure(OWNER, 'signing');
  const seen = new Set((await f.signing()).map(k => k.kid));
  for (let i = 0; i < 100; i++) { await f.rotate(); for (const k of await f.signing()) seen.add(k.kid); }
  const kept = new Set((await f.signing()).map(k => k.kid)), pruned = [...seen].filter(kid => !kept.has(kid));
  assert.equal(kept.size, KEY_HISTORY_LIMIT); assert.equal(pruned.length, 85);
  const state = await f.ask(IdentityKeyRetainedState);
  assert.deepEqual(state.tombstones, { kids: 85, pages: 1, legacy: 0, rows: 1 });
  assert.deepEqual(state.signing, { records: 16, pinned: 0, own: 16, limit: KEY_HISTORY_LIMIT });
  assert.equal(await f.rows(key('identity-key-pruned', OWNER)), 87, 'one compact archive page, 85 exact membership rows and one append-state row');
  for (const kid of [pruned[0], pruned[42], pruned.at(-1)]) await assert.rejects(f.act(RegisterIdentityKey, await external(kid)), { code: 'key_exists' });
  assert.ok((await f.act(RegisterIdentityKey, await external('never-pruned'))).kid, 'an unseen kid still registers');
});

test('tombstone pages roll over at TOMBSTONE_PAGE kids and membership stays exact across pages', async () => {
  const f = fixture({ historyLimit: 2 }); await f.keys.ensure(OWNER, 'signing');
  const seen = [];
  for (let i = 0; i < TOMBSTONE_PAGE + 4; i++) { for (const k of await f.signing()) if (!seen.includes(k.kid)) seen.push(k.kid); await f.rotate(); }
  const kept = new Set((await f.signing()).map(k => k.kid)), pruned = seen.filter(kid => !kept.has(kid));
  const state = await f.ask(IdentityKeyRetainedState);
  assert.equal(state.tombstones.kids, pruned.length); assert.equal(state.tombstones.pages, 2); assert.equal(state.tombstones.rows, 2);
  for (const kid of [pruned[0], pruned[TOMBSTONE_PAGE - 1], pruned[TOMBSTONE_PAGE], pruned.at(-1)]) await assert.rejects(f.act(RegisterIdentityKey, await external(kid)), { code: 'key_exists' });
});

test('legacy one-row-per-kid tombstones still refuse reuse and are folded into the pages at the next prune', async () => {
  const f = fixture({ historyLimit: 2 }); await f.keys.ensure(OWNER, 'signing');
  await f.store.transaction(async tx => { for (const kid of ['legacy-a', 'legacy-b', 'legacy-c']) await tx.set(key('identity-key-pruned', OWNER, kid), { kid, purpose: 'signing', prunedAt: 1 }); });
  await assert.rejects(f.act(RegisterIdentityKey, await external('legacy-b')), { code: 'key_exists' }, 'before compaction');
  assert.deepEqual((await f.ask(IdentityKeyRetainedState)).tombstones, { kids: 3, pages: 0, legacy: 3, rows: 3 });
  await f.rotate(); await f.rotate();
  const state = await f.ask(IdentityKeyRetainedState);
  assert.equal(state.tombstones.legacy, 0); assert.equal(state.tombstones.rows, 1); assert.equal(state.tombstones.kids, 4);
  for (const kid of ['legacy-a', 'legacy-b', 'legacy-c']) await assert.rejects(f.act(RegisterIdentityKey, await external(kid)), { code: 'key_exists' }, 'after compaction');
});

/** A moved identity arriving with `chain` published keys (real continuity), activated by the rotation at activation.
 * `arrival`: the `transfer-in/v1` record it leaves behind (the source's records and this host's statement/attestation),
 * which keys.mjs reads to compute the published document's headroom; `long`: 128-character kids for the chain. */
async function movedIdentity(f, chain = 15, { arrival = null, long = false } = {}) {
  const lineage = [];
  for (let i = 0; i <= chain; i++) {
    const keyPair = await pair(), kid = long ? `chain-${i}-`.padEnd(128, 'k') : `chain-${i}`, previous = lineage.at(-1);
    lineage.push({ kid, pair: keyPair, entry: { kid, publicJwk: keyPair.publicJwk, state: 'retired', created: 1790000000 + i, retired: 1790000001 + i, predecessor: previous?.kid ?? null, continuity: previous ? await continuity(OWNER, previous.kid, previous.pair, { kid, publicJwk: keyPair.publicJwk }) : null } });
  }
  const arriving = lineage.at(-1);
  await f.store.transaction(tx => tx.set('transfer-in/v1', { state: 'importing' }));
  await f.keys.importTransfer(OWNER, { signing: { kid: arriving.kid, jwk: arriving.pair.privateJwk, predecessor: arriving.entry.predecessor, continuity: arriving.entry.continuity, created: arriving.entry.created }, history: lineage.slice(0, -1).map(k => k.entry) });
  await f.store.transaction(tx => tx.set('transfer-in/v1', { state: 'activating' }));
  await f.keys.rotateAtActivation(OWNER, { expectedKid: arriving.kid });
  await f.store.transaction(tx => tx.set('transfer-in/v1', { state: 'active', ...arrival ?? {} }));
  return lineage;
}
/** An arrival record whose `moves` are 16 records at their caps (the worst case for the remaining headroom). */
const fullArrival = () => ({ sourceMoves: Array.from({ length: 15 }, () => ({ statement: 's'.repeat(MAX_STATEMENT_BYTES), attestation: 'a'.repeat(MAX_ATTESTATION_BYTES) })), statement: { jws: 's'.repeat(MAX_STATEMENT_BYTES) }, attestation: 'a'.repeat(MAX_ATTESTATION_BYTES) });
const arrivalMoves = arrival => [...arrival.sourceMoves, { statement: arrival.statement.jws, attestation: arrival.attestation }];
const docOf = async (f, moves = [{ statement: 'placeholder', attestation: null }]) => identityDocument({ issuer: ISSUER, identity: { id: OWNER, status: 'active', moves }, signing: await f.signing() });
const published = async f => documentLineage(signingKeysOf(await docOf(f)), OWNER);

test('a moved identity: pinned keys do not fill the history, its chain is never pruned, and without headroom the next own key is refused', async () => {
  const f = fixture(), lineage = await movedIdentity(f, 15);
  let state = await f.ask(IdentityKeyRetainedState); assert.deepEqual([state.signing.pinned, state.signing.own], [16, 1], 'activation rotated despite 16 pinned keys');
  for (let i = 0; i < KEY_HISTORY_LIMIT - 1; i++) await f.rotate();
  state = await f.ask(IdentityKeyRetainedState); assert.deepEqual([state.signing.pinned, state.signing.own], [16, KEY_HISTORY_LIMIT]);
  // Every own key is a chain link, and an arrival record without its statement gives no headroom (fail closed).
  await assert.rejects(f.rotate(), { code: 'key_history_full' });
  assert.equal(state.tombstones.kids, 0, 'nothing was pruned');
  const chain = await published(f); assert.equal(chain[0].kid, lineage[0].kid, 'the published lineage reaches the first statement signer'); assert.equal(chain.length, 16 + KEY_HISTORY_LIMIT);
  // Keys that are not chain links (a revoked, externally registered key) are still pruned.
  const g = fixture(); await movedIdentity(g, 3); await g.act(RegisterIdentityKey, await external('side-key')); await g.act(RevokeIdentityKey, { purpose: 'signing', kid: 'side-key', reason: 'owner' });
  for (let i = 0; i < KEY_HISTORY_LIMIT - 2; i++) await g.rotate();
  await g.rotate(); assert.ok(!(await g.signing()).some(k => k.kid === 'side-key'), 'the non-chain key was pruned');
  assert.equal((await published(g))[0].kid, 'chain-0');
});

test('a moved identity keeps rotating beyond 16 own keys while its published document has headroom, and is refused near the real bound', async () => {
  // Review 2026-10-23 item 3: the 16-key base is a reserve, not a ceiling. Bytes bind here (128-character chain kids and
  // 16 records at their caps); the document is publishable after every successful rotation.
  const arrival = fullArrival(), f = fixture(); await movedIdentity(f, 15, { arrival, long: true });
  let rotations = 0;
  for (;;) {
    try { await f.rotate(); rotations++; } catch (error) { assert.equal(error.code, 'key_history_full'); break; }
    const doc = await docOf(f, arrivalMoves(arrival)); assert.ok(doc, `publishable after ${rotations} rotations`);
    assert.ok(Buffer.byteLength(JSON.stringify(doc)) + 4096 <= MAX_MOVES_DOCUMENT_BYTES, 'the header and certification reserve still fits');
  }
  const state = await f.ask(IdentityKeyRetainedState);
  assert.ok(state.signing.own > KEY_HISTORY_LIMIT, `own ${state.signing.own}`); assert.equal(state.tombstones.kids, 0);
  // The refusal is near the real bound (the estimate is conservative: published times at their maximum width), not at 16.
  const doc = await docOf(f, arrivalMoves(arrival)); assert.ok(Buffer.byteLength(JSON.stringify(doc)) + 4096 + 2 * MOVE_KEY_ALLOWANCE > MAX_MOVES_DOCUMENT_BYTES);
  assert.equal((await published(f))[0].kid, 'chain-0-'.padEnd(128, 'k'), 'the chain is intact');
  // The 64-key limit binds when keys are small.
  const g = fixture(); await movedIdentity(g, 3, { arrival: { sourceMoves: [], statement: { jws: 's'.repeat(200) }, attestation: null } });
  for (;;) { try { await g.rotate(); } catch (error) { assert.equal(error.code, 'key_history_full'); break; } }
  assert.equal((await g.signing()).length + 4, MAX_DOCUMENT_KEYS, '64 keys including the certification-key reserve');
});

test('15 rotations of an identity that never moved keep its document publishable (16 own keys fit the no-moves bound)', async () => {
  const f = fixture(); await f.keys.ensure(OWNER, 'signing');
  for (let i = 0; i < 15; i++) await f.rotate();
  assert.equal((await f.signing()).length, KEY_HISTORY_LIMIT);
  const doc = identityDocument({ issuer: 'https://identity.3sln.example', identity: { id: OWNER, status: 'active', handle: 'n.a-reasonably-long-handle-name' }, signing: await f.signing(), certification: [{ kid: crypto.randomUUID(), publicJwk: (await pair()).publicJwk, state: 'active', createdAt: 1800000000000 }] });
  assert.ok(doc, 'not the uniform 404'); assert.ok(Buffer.byteLength(JSON.stringify(doc)) > 16384, 'above the old 16 KiB bound'); assert.ok(Buffer.byteLength(JSON.stringify(doc)) <= DOCUMENT_BYTES);
});

test('seeded chaos: rotations, registrations, revocations and reuse attempts (register and import) across tombstone pages keep the bounds, the chain and exact anti-reuse', async () => {
  await forEachSeed(3, async random => {
    const moved = random.chance(0.5), f = fixture({ historyLimit: 2 });
    const legacy = ['legacy-a', 'legacy-b', 'legacy-c'];
    await f.store.transaction(async tx => { for (const kid of legacy) await tx.set(key('identity-key-pruned', OWNER, kid), { kid, purpose: 'signing', prunedAt: 1 }); });
    const arrival = moved && random.chance(0.5) ? { sourceMoves: [], statement: { jws: 's'.repeat(300) }, attestation: null } : null;
    const lineage = moved ? await movedIdentity(f, 1 + random.int(6), { arrival }) : (await f.keys.ensure(OWNER, 'signing'), null);
    const ever = new Set([...legacy, ...(await f.signing()).map(k => k.kid)]), externals = [];
    let present = new Set((await f.signing()).map(k => k.kid));
    for (let step = 0; step < 400; step++) {
      const op = random.pick(['rotate', 'rotate', 'rotate', 'rotate', 'rotate', 'rotate', 'register', 'revoke', 'reuse']);
      try {
        if (op === 'rotate') await f.rotate();
        else if (op === 'register') { const kid = `x-${step}`; await f.act(RegisterIdentityKey, await external(kid)); externals.push(kid); }
        else if (op === 'revoke' && externals.length) await f.act(RevokeIdentityKey, { purpose: 'signing', kid: externals.pop(), reason: 'owner' });
        else if (op === 'reuse') { const gone = [...ever].filter(kid => !present.has(kid)); if (gone.length) await assert.rejects(f.act(RegisterIdentityKey, await external(random.pick(gone))), { code: 'key_exists' }); }
      } catch (error) { if (!['key_history_full', 'not_found'].includes(error?.code)) throw error; }
      const history = await f.signing(); for (const k of history) ever.add(k.kid); present = new Set(history.map(k => k.kid));
      const state = await f.ask(IdentityKeyRetainedState);
      if (!arrival) assert.ok(state.signing.own <= state.signing.limit, `own ${state.signing.own}`);
      assert.equal(state.tombstones.kids, [...ever].filter(kid => !present.has(kid)).length, 'every pruned kid (and every legacy row) is tombstoned exactly once');
      if (moved) {
        const records = history.map(k => ({ kid: k.kid, predecessor: k.predecessor, state: k.state })), current = history.find(k => k.current);
        assert.ok(continuityChain(records, current.kid).has(lineage[0].kid), 'the chain from the current key reaches the first statement signer');
        // (A legacy externally registered key is listed `active` too, which no document allows; checked without one.)
        if (arrival && history.filter(k => k.state === 'active').length === 1) assert.ok(await docOf(f, arrivalMoves(arrival)), 'the moved document stays publishable');
      }
    }
    // Whatever the seed, an unmoved run crosses the 128-kid page boundary before the import checks.
    if (!moved) { while (externals.length) await f.act(RevokeIdentityKey, { purpose: 'signing', kid: externals.pop(), reason: 'owner' }); while ((await f.ask(IdentityKeyRetainedState)).tombstones.pages < 2) { await f.rotate(); for (const k of await f.signing()) ever.add(k.kid); } const history = await f.signing(); for (const k of history) ever.add(k.kid); present = new Set(history.map(k => k.kid)); assert.equal((await f.ask(IdentityKeyRetainedState)).tombstones.kids, [...ever].filter(kid => !present.has(kid)).length); }
    // importTransfer reuse: custody ends, an arrival restarts; importing a pruned or legacy kid is refused exactly.
    const gone = [...ever].filter(kid => !present.has(kid));
    await f.keys.destroyCustody(OWNER); await f.store.transaction(tx => tx.set('transfer-in/v1', { state: 'importing' }));
    const keep = (await f.signing()).map(k => ({ kid: k.kid, publicJwk: k.publicJwk, state: k.state === 'revoked' ? 'revoked' : 'retired' }));
    const fresh = await pair();
    for (const kid of [random.pick(legacy), ...gone.length ? [random.pick(gone)] : []]) {
      await assert.rejects(f.keys.importTransfer(OWNER, { signing: { kid, jwk: fresh.privateJwk }, history: keep }), { code: 'key_exists' }, `import of pruned ${kid}`);
      await assert.rejects(f.keys.importTransfer(OWNER, { signing: { kid: 'new-arrival', jwk: fresh.privateJwk }, history: [...keep, { kid, publicJwk: fresh.publicJwk, state: 'retired' }] }), { code: 'key_exists' });
    }
    assert.ok((await f.keys.importTransfer(OWNER, { signing: { kid: 'new-arrival', jwk: fresh.privateJwk }, history: keep })).imported, 'an unpruned kid imports');
  });
});
