// PORT-4 producer side of the successor-chain byte budget (docs/spec/identity-portability.md §4 and §7 "Size"; DEVLOG
// 2026-10-23 "Successor chain byte budget and key tombstone compaction"). A destination never creates a chain that a
// verifier refuses: an intake whose statement or resulting document would exceed the budget is refused before anything
// is reserved, imported or signed, and the 16th move of a rotating chain with maximum-length URIs activates (with every
// statement signer still published) and is adopted by a verifier holding the origin pin. Engine-level: the real
// destination engine and intake engine, simulated sources speaking the real wire formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationFixture, OWNER, DEST } from './helpers/transfer-in.mjs';
import { World, createNetwork, json, pair, continuity } from './helpers/portability-network.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { metadataStore } from '../packages/app/memory-providers.mjs';
import { createTestEngine } from './helpers/app-engine.mjs';
import { createAttestationKeySet } from '../packages/identity/attestation-keys.mjs';
import { parseMoveStatement, statementDigest, documentLineage, MAX_MOVES, MAX_MOVE_URI, MAX_MOVES_DOCUMENT_BYTES } from '../packages/identity/succession.mjs';
import { SuccessorRegistry, signingKeysOf } from '../packages/identity/successors.mjs';

const longOrigin = i => `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'s'.repeat(44 - String(i).length)}${i}.example`;
const longIdentity = (origin, sub, n = 1, length = MAX_MOVE_URI) => { const base = `${origin}/identity/${sub}/r${n}/`; return base + 'p'.repeat(length - base.length); };
const bytes = value => Buffer.byteLength(JSON.stringify(value));

/** An identity that moved `hops` times across maximum-length hosts (rotating at each), now hosted at the last one,
 * which attests a destination's statement at once. */
async function movedSource(t, hops, { uriLength = MAX_MOVE_URI } = {}) {
  const clock = fakeClock(Date.UTC(2026, 9, 23, 12)), net = createNetwork(), world = new World({ net, clock }), hosts = [];
  world.identityURI = (provider, identity, n = 1) => longIdentity(provider.origin, identity.sub, n, uriLength);
  for (let i = 0; i <= hops; i++) { const host = await world.provider(longOrigin(i)); host.config = await createAttestationKeySet({ kid: `a1-s${i}` }); hosts.push(host); }
  const id = await world.identity({ sub: OWNER }); world.host(hosts[0], id);
  for (let i = 0; i < hops; i++) await world.move(id, hosts[i], hosts[i + 1], { rotate: true });
  const source = hosts[hops];
  source.extra = async request => {
    if (request.path !== '/move' || request.method !== 'POST') return null;
    const parsed = parseMoveStatement(request.body.statement), entry = source.state.get(OWNER);
    const attestation = await source.attest({ bindle: 'move-attestation', v: 1, iss: source.origin, sub: OWNER, seq: parsed.payload.seq, statement: await statementDigest(parsed.input), to: parsed.payload.to, aep: 40, at: parsed.payload.iat });
    entry.status = 'moved'; entry.moved = { statement: request.body.statement, attestation };
    return json({ status: 'attested', attestation, redirect_until: null });
  };
  const dest = await destinationFixture(t, { net, clock });
  const pkg = () => ({ bindle: 'identity-package', v: 1, sub: OWNER, kind: 'person', from: { iss: source.origin, identity: source.state.get(OWNER).identity }, keys: { signing: { kid: id.current.kid, jwk: id.current.pair.privateJwk } }, transfer: { id: 'transfer-id-0123456789', exp: 1 } });
  return { clock, net, world, hosts, id, source, dest, pkg };
}
/** A same-host rotation at the source with a 128-character kid (the kid bound), republished in the source document. */
async function rotateLongKid(fx, index) {
  const { id, source } = fx, key = await pair(), kid = `${String(index).padStart(3, '0')}${'L'.repeat(125)}`, previous = id.current;
  const entry = { kid, use: 'sig', alg: 'ES256', jwk: key.publicJwk, state: 'active', created: 1792400000 + index, predecessor: previous.kid, continuity: await continuity(OWNER, previous.kid, previous.pair, { kid, publicJwk: key.publicJwk }) };
  previous.entry.state = 'retired'; previous.entry.retired = entry.created;
  id.keys.push({ kid, pair: key, entry }); source.state.get(OWNER).keys = id.documentKeys();
}

test('the 16th move of a rotating chain with maximum-length URIs passes intake, activates with every statement signer published, and is adopted', async t => {
  const fx = await movedSource(t, MAX_MOVES - 1), { dest, hosts, id } = fx;
  const db = await createTestEngine(); t.after(() => db.dispose());
  const verifier = new SuccessorRegistry({ store: metadataStore(db.metadata), client: dest.client, enabled: () => true, clock: fx.clock.now });
  // The verifier has known the identity since before its first move (its origin pin).
  const origin = { iss: hosts[0].origin, sub: OWNER };
  await verifier.track({ origin, identity: longIdentity(hosts[0].origin, OWNER), signing: { kid: id.keys[0].kid, publicJwk: id.keys[0].pair.publicJwk } });
  assert.equal((await dest.check(fx.pkg())).mode, 'attested');
  await dest.reserve(fx.pkg());
  assert.equal((await dest.begin(fx.pkg())).state, 'active');
  const record = await dest.get(); assert.equal(parseMoveStatement(record.statement.jws).payload.seq, MAX_MOVES);
  // Every imported key is pinned and none counts against the 16-key own history, so the activation rotation succeeded.
  const history = await dest.registry.history(OWNER, { purpose: 'signing' });
  assert.equal(history.length, MAX_MOVES + 1); assert.equal(history.at(-1).current, true);
  const state = await dest.registry.retainedState(OWNER); assert.deepEqual([state.signing.pinned, state.signing.own], [MAX_MOVES, 1]);
  const doc = await dest.document(); assert.ok(doc, 'the destination publishes its document');
  assert.equal(doc.moves.length, MAX_MOVES); assert.ok(bytes(doc) <= MAX_MOVES_DOCUMENT_BYTES);
  // Every statement signer is in the published continuity lineage (spec §7), in non-decreasing order.
  const lineage = await documentLineage(signingKeysOf(doc), OWNER), positions = doc.moves.map(m => lineage.findIndex(k => k.kid === parseMoveStatement(m.statement).header.kid));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p >= positions[i - 1])), JSON.stringify(positions));
  // A verifier 16 moves behind is handed the chain (refresh follows at most 3 redirect hops) and adopts all of it.
  const adopted = await verifier.adopt(origin, doc.moves);
  assert.equal(adopted.outcome, 'adopted', JSON.stringify(adopted)); assert.equal(adopted.adopted, MAX_MOVES); assert.equal(adopted.current.iss, DEST);
});

test('intake refuses a move whose resulting document would exceed the budget, before reserving, importing or signing', async t => {
  const fx = await movedSource(t, MAX_MOVES - 1), { dest } = fx;
  // 25 same-host rotations with 128-character kids: 41 keys (within 64) but beyond the byte budget at the destination.
  for (let i = 0; i < 25; i++) await rotateLongKid(fx, i);
  for (const attempt of [() => dest.check(fx.pkg()), () => dest.reserve(fx.pkg())]) await assert.rejects(attempt(), { code: 'document_budget_exceeded', status: 409 });
  await assert.rejects(dest.begin(fx.pkg()), error => ['document_budget_exceeded', 'reservation_mismatch'].includes(error.code));
  assert.ok(!await dest.identityRecord(), 'nothing reserved'); assert.ok(!await dest.get(), 'no transfer-in record');
  assert.equal((await dest.registry.history(OWNER, { purpose: 'signing' })).length, 0, 'nothing imported');
  assert.equal(fx.source.state.get(OWNER).status, 'active', 'the source never received a statement');
});

test('intake refuses more keys than a document may list, and an identity URI above the move cap, with clear codes', async t => {
  const fx = await movedSource(t, 2), { dest } = fx;
  for (let i = 0; i < 46; i++) await fx.id.addKey(); fx.source.state.get(OWNER).keys = fx.id.documentKeys();
  await assert.rejects(dest.check(fx.pkg()), { code: 'document_budget_exceeded' });
  const long = await movedSource(t, 0, { uriLength: MAX_MOVE_URI + 1 });
  await assert.rejects(long.dest.check(long.pkg()), { code: 'identity_uri_too_long', status: 409 });
  assert.ok(!await long.dest.identityRecord());
  const fits = await movedSource(t, 0, { uriLength: MAX_MOVE_URI });
  assert.equal((await fits.dest.check(fits.pkg())).mode, 'attested', 'exactly the cap is accepted');
});
