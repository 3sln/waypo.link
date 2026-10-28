// PORT-5: verifier adoption (packages/identity/successors.mjs; docs/spec/identity-portability.md rev 3.2 §5.1, §8,
// §12 "Verifiers", "Attestation-key continuity (P16)"; design §10.3). Engine-level tests over the simulated network of
// tests/helpers/portability-network.mjs: real statements, attestations, continuity statements and wire formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { metadataStore } from '../packages/app/memory-providers.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { createTestEngine } from './helpers/app-engine.mjs';
import { World, json } from './helpers/portability-network.mjs';
import { EXT } from '../packages/core/extensions.mjs';
import { SuccessorRegistry, portabilityClient, portabilityURL, createPortabilityFetch, PORTABILITY_LIMITS, SUCCESSOR_OPERATIONS, AdoptSuccessor, ConfirmSuccessor, PresentSuccessor, ResolveSuccessor } from '../packages/identity/successors.mjs';
import { signMoveStatement, signMoveAttestation, statementDigest, parseMoveStatement, attestationKeyThumbprint } from '../packages/identity/succession.mjs';
import { removeAttestationKey, attestationRootThumbprints, SHIPPED_ATTESTATION_ROOTS } from '../packages/identity/attestation-keys.mjs';

const A = 'https://a.example', B = 'https://b.example', C = 'https://c.example', D = 'https://d.example', E = 'https://e.example', X = 'https://x.example';
const DAY = 86400000;

async function setup({ roots = {}, enabled = true, providers = [A, B, C] } = {}) {
  const clock = fakeClock(Date.UTC(2026, 9, 22, 12)), world = new World({ clock });
  const hosts = {}; for (const origin of providers) hosts[origin] = await world.provider(origin);
  const state = { enabled }, dbs = [];
  const verifier = (options = {}) => {
    const db = new SqliteMetadata(':memory:'); dbs.push(db); const logs = [];
    const registry = new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: world.net.fetch, clock: clock.now }), enabled: () => state.enabled, roots: options.roots ?? roots, clock: clock.now, log: event => logs.push(event) });
    return Object.assign(registry, { logs });
  };
  const fx = { clock, world, hosts, state, verifier, registry: verifier(), close: () => dbs.forEach(db => db.close()) };
  fx.track = (registry, provider, identity) => registry.track({ origin: { iss: provider.origin, sub: identity.sub }, identity: provider.state.get(identity.sub).identity, signing: { kid: identity.current.kid, publicJwk: identity.current.pair.publicJwk } });
  return fx;
}
const origin = (provider, identity) => ({ iss: provider.origin, sub: identity.sub });

test('an attested move is adopted automatically: both signatures, items 1–5, pin, index, aep floor and authority reset', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  assert.equal((await registry.resolve({ iss: A, sub: id.sub })).accepts, true);
  await world.move(id, hosts[A], hosts[B]);
  const adopted = await registry.refresh(origin(hosts[A], id));
  assert.equal(adopted.outcome, 'adopted'); assert.equal(adopted.authorityHeld, true);
  assert.equal(adopted.attestation_first_use, false, 'the source\'s keys were pinned when the relationship started (track)');
  const resolved = await registry.resolve({ iss: B, sub: id.sub });
  assert.deepEqual(resolved.origin, { iss: A, sub: id.sub }); assert.equal(resolved.current.iss, B); assert.equal(resolved.accepts, true); assert.equal(resolved.authorityHeld, true); assert.equal(resolved.aep, 3);
  // Certificates and fresh signatures from the earlier host fail after adoption.
  assert.equal((await registry.resolve({ iss: A, sub: id.sub })).accepts, false);
  const pin = await registry.pin(origin(hosts[A], id));
  assert.equal(pin.head.seq, 1); assert.equal(pin.signing.kid, id.current.kid, 'the pin follows the destination rotation (continuity-linked)');
  assert.ok(pin.seen.superseded.includes(id.keys[0].kid));
  assert.equal((await registry.pins.read(A)).firstUse, true);
  // Applied again: a replay, ignored.
  assert.equal((await registry.adopt(origin(hosts[A], id), [hosts[B].state.get(id.sub).moves[0]])).outcome, 'replay');
});

test('an unattested record is never adopted automatically: pending successor with the warning facts, then an explicit local act', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B], { attest: false });
  const offered = await registry.refresh(origin(hosts[A], id));
  assert.equal(offered.outcome, 'pending'); assert.equal(offered.reason, 'unattested'); assert.equal(offered.oldProviderConfirmed, false);
  assert.equal((await registry.resolve({ iss: B, sub: id.sub })), null, 'nothing adopted');
  const [pending] = await registry.pending(origin(hosts[A], id));
  assert.deepEqual([pending.oldHost, pending.newHost, pending.oldProviderConfirmed], [A, B, false]);
  const adopted = await registry.confirm(origin(hosts[A], id), { digest: pending.digest });
  assert.equal(adopted.outcome, 'adopted'); assert.equal(adopted.authorityHeld, true);
  const resolved = await registry.resolve({ iss: B, sub: id.sub }); assert.equal(resolved.unattested, true); assert.equal(resolved.current.iss, B);
  assert.deepEqual(await registry.pending(origin(hosts[A], id)), []);
});

test('no pending successor while the pinned host declares portability.v1 and serves the identity with the pinned key (IP-R1-M7)', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  const record = await world.move(id, hosts[A], hosts[B], { attest: false, keepSource: true });
  const outcome = await registry.adopt(origin(hosts[A], id), [record]);
  assert.equal(outcome.outcome, 'refused'); assert.equal(outcome.sourceActive, true);
  assert.deepEqual(await registry.pending(origin(hosts[A], id)), []);
  // An attested record from a source that still serves the identity is not adopted either (IP-R1-H2).
  const id2 = await world.identity(); world.host(hosts[A], id2); await fx.track(registry, hosts[A], id2);
  const attested = await world.move(id2, hosts[A], hosts[B], { keepSource: true });
  const second = await registry.adopt(origin(hosts[A], id2), [attested]);
  assert.equal(second.outcome, 'refused'); assert.equal(second.sourceActive, true);
});

test('equivocation: a differing attested record at or below the pin, or two at the same seq, fails closed and keeps the pin', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  const first = id.keys[0];
  const recB = await world.move(id, hosts[A], hosts[B]);
  assert.equal((await registry.refresh(origin(hosts[A], id))).outcome, 'adopted');
  // The same source attests a second destination for seq 1 (statement signed by the key active at A).
  const statement = await signMoveStatement({ kid: first.kid, payload: { bindle: 'identity-move', v: 1, sub: id.sub, kind: 'person', seq: 1, prev: null, from: parseMoveStatement(recB.statement).payload.from, to: { iss: C, identity: `${C}/identity/${id.sub}` }, iat: Math.floor(Date.now() / 1000) } }, first.pair.privateKey);
  const attestation = await hosts[A].attest({ bindle: 'move-attestation', v: 1, iss: A, sub: id.sub, seq: 1, statement: await statementDigest(parseMoveStatement(statement).input), to: { iss: C, identity: `${C}/identity/${id.sub}` }, aep: 3, at: 1 });
  const contested = await registry.adopt(origin(hosts[A], id), [{ statement, attestation }]);
  assert.equal(contested.outcome, 'contested'); assert.equal(contested.reason, 'equivocation');
  const resolved = await registry.resolve({ iss: B, sub: id.sub });
  assert.equal(resolved.status, 'contested'); assert.equal(resolved.accepts, false); assert.equal(resolved.current.iss, B, 'the pin is kept');
  assert.ok(registry.logs.some(entry => entry.action === 'successor-contested'));
  // A differing record without a valid attestation is ignored, not equivocation.
  const fx2 = await setup(); t.after(fx2.close);
  const id2 = await fx2.world.identity(); fx2.world.host(fx2.hosts[A], id2); await fx2.track(fx2.registry, fx2.hosts[A], id2);
  const rec = await fx2.world.move(id2, fx2.hosts[A], fx2.hosts[B]); await fx2.registry.refresh(origin(fx2.hosts[A], id2));
  assert.equal((await fx2.registry.adopt(origin(fx2.hosts[A], id2), [{ statement: rec.statement, attestation: null }])).outcome, 'replay');
});

test('two different attested records for the next seq presented together are equivocation', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  const k1 = id.current, from = { iss: A, identity: hosts[A].state.get(id.sub).identity };
  const forge = async to => { const statement = await signMoveStatement({ kid: k1.kid, payload: { bindle: 'identity-move', v: 1, sub: id.sub, kind: 'person', seq: 1, prev: null, from, to, iat: 1800000000 } }, k1.pair.privateKey); return { statement, attestation: await hosts[A].attest({ bindle: 'move-attestation', v: 1, iss: A, sub: id.sub, seq: 1, statement: await statementDigest(parseMoveStatement(statement).input), to, aep: 3, at: 1 }) }; };
  const outcome = await registry.adopt(origin(hosts[A], id), [await forge({ iss: B, identity: `${B}/identity/${id.sub}` }), await forge({ iss: C, identity: `${C}/identity/${id.sub}` })]);
  assert.equal(outcome.outcome, 'contested');
});

test('no rollback: a destination document reviving a kid the verifier saw retired is refused', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]);
  await registry.store.transaction(async tx => { const path = `successor/${encodeURIComponent(A)}/${id.sub}/`; const pin = await tx.get(path); pin.seen.retired.push(id.current.kid); await tx.set(path, pin); });
  const outcome = await registry.refresh(origin(hosts[A], id));
  assert.equal(outcome.outcome, 'refused'); assert.equal(outcome.reason, 'key-rollback');
});

test('P16: chained attestation-key rotation extends the pin; a lapsed domain\'s new root is an attestation reset for a pinned verifier and first use for a fresh one', async t => {
  const fx = await setup({ providers: [A, B, X] }); t.after(fx.close);
  const { world, hosts, registry } = fx;
  // Rotation chained from a pinned key: adopted.
  const id = await world.identity(); world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  const other = await world.identity(); world.host(hosts[A], other); await fx.track(registry, hosts[A], other);
  await world.move(other, hosts[A], hosts[B]); assert.equal((await registry.refresh(origin(hosts[A], other))).outcome, 'adopted');
  await hosts[A].rotateAttestation(); fx.clock.advance(2 * 3600000);
  const third = await world.identity(); world.host(hosts[A], third); await fx.track(registry, hosts[A], third);
  await world.move(third, hosts[A], hosts[B]);
  const chained = await registry.refresh(origin(hosts[A], third));
  assert.equal(chained.outcome, 'adopted'); assert.equal(chained.attestation_first_use, false);
  assert.equal((await registry.pins.read(A)).thumbprints.length, 2, 'the chained key joined the pin');
  // Lapsed domain: a new owner of a.example publishes a fresh root; with an old file (its key) the attacker forges a move.
  await hosts[A].lapse(); fx.clock.advance(2 * 3600000);
  await world.move(id, hosts[A], hosts[X]);
  const refused = await registry.refresh(origin(hosts[A], id));
  assert.equal(refused.outcome, 'pending'); assert.equal(refused.reason, 'attestation-reset');
  assert.equal(await registry.resolve({ iss: X, sub: id.sub }), null, 'never adopted automatically');
  assert.ok(registry.logs.some(entry => entry.action === 'attestation-reset' && entry.issuer === A));
  // A verifier that never saw a.example accepts the forged chain on first use, and is told so.
  const fresh = fx.verifier();
  const first = await fresh.firstContact({ iss: X, sub: id.sub, purpose: 'origin-linking' });
  assert.equal(first.outcome, 'verified'); assert.equal(first.attestation_first_use, true); assert.deepEqual(first.origin, { iss: A, sub: id.sub });
});

test('P16: a preconfigured root is never pinned on first use; the shipped 3sln.me root list fails closed until minted', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts } = fx, id = await world.identity(); world.host(hosts[A], id);
  const realRoot = await attestationRootThumbprints(hosts[A].set);
  await world.move(id, hosts[A], hosts[B]);
  const configured = fx.verifier({ roots: { [A]: realRoot } });
  const linked = await configured.firstContact({ iss: B, sub: id.sub, purpose: 'origin-linking' });
  assert.equal(linked.outcome, 'verified'); assert.equal(linked.attestation_first_use, false, 'a preconfigured root is not first use');
  const wrong = fx.verifier({ roots: { [A]: ['A'.repeat(43)] } });
  const reset = await wrong.firstContact({ iss: B, sub: id.sub, purpose: 'origin-linking' });
  assert.equal(reset.outcome, 'unverified'); assert.equal(reset.reason, 'attestation-reset');
  assert.deepEqual(SHIPPED_ATTESTATION_ROOTS['https://3sln.me'], []);
});

test('a kid absent from a fresh JWKS is revoked: the record it signed is not adopted automatically (IP-R1-M3)', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await registry.pins.evaluate(A, (await registry.client.attestationKeys(A)).jwks);
  await world.move(id, hosts[A], hosts[B]); // signed by A's first key
  await hosts[A].rotateAttestation(); fx.clock.advance(2 * 3600000);
  await registry.pins.evaluate(A, (await registry.client.attestationKeys(A)).jwks); // pins the chained second key
  hosts[A].config = removeAttestationKey(hosts[A].config, hosts[A].set.keys[0].kid); fx.clock.advance(2 * 3600000);
  const outcome = await registry.refresh(origin(hosts[A], id));
  assert.equal(outcome.outcome, 'pending'); assert.equal(outcome.reason, 'attestation-revoked');
});

test('item 4: a record whose to.identity disagrees with the destination directory is not adopted (IP-R1-M4)', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]);
  hosts[B].state.get(id.sub).identity = `${B}/elsewhere/${id.sub}`;
  const outcome = await registry.adopt(origin(hosts[A], id), [hosts[A].state.get(id.sub).moved]);
  assert.equal(outcome.outcome, 'refused'); assert.equal(outcome.reason, 'destination-directory-mismatch');
});

test('index conflict: a move onto an origin principal the verifier already knows contests both identities (IP-R1-M5)', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, mover = await world.identity(), squatter = await world.identity({ sub: mover.sub });
  world.host(hosts[A], mover); await fx.track(registry, hosts[A], mover);
  world.host(hosts[B], squatter); await fx.track(registry, hosts[B], squatter);
  await world.move(mover, hosts[A], hosts[C]);
  // Move the identity onto (B, sub) — another origin principal the verifier pins.
  hosts[C].state.delete(mover.sub);
  const record = hosts[A].state.get(mover.sub).moved;
  const statement = await signMoveStatement({ kid: mover.keys[0].kid, payload: { ...parseMoveStatement(record.statement).payload, to: { iss: B, identity: `${B}/identity/${mover.sub}` } } }, mover.keys[0].pair.privateKey);
  const attestation = await hosts[A].attest({ bindle: 'move-attestation', v: 1, iss: A, sub: mover.sub, seq: 1, statement: await statementDigest(parseMoveStatement(statement).input), to: { iss: B, identity: `${B}/identity/${mover.sub}` }, aep: 3, at: 1 });
  hosts[A].state.get(mover.sub).moved = { statement, attestation };
  hosts[B].state.get(mover.sub).moves = [{ statement, attestation }]; hosts[B].state.get(mover.sub).keys = mover.documentKeys();
  const outcome = await registry.adopt(origin(hosts[A], mover), [{ statement, attestation }]);
  assert.equal(outcome.outcome, 'contested');
  assert.equal((await registry.resolve({ iss: B, sub: mover.sub })).status, 'contested');
  assert.equal((await registry.pin(origin(hosts[A], mover))).status, 'contested');
});

test('a verifier more than one move behind applies each record in order; a fourth redirect hop and a cycle fail', async t => {
  const fx = await setup({ providers: [A, B, C, D, E] }); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]); await world.move(id, hosts[B], hosts[C]); await world.move(id, hosts[C], hosts[D]);
  const adopted = await registry.refresh(origin(hosts[A], id));
  assert.equal(adopted.outcome, 'adopted'); assert.equal(adopted.adopted, 3); assert.equal(adopted.current.iss, D);
  assert.equal((await registry.pin(origin(hosts[A], id))).head.seq, 3);
  for (const host of [B, C, D]) assert.deepEqual((await registry.resolve({ iss: host, sub: id.sub })).origin, { iss: A, sub: id.sub });
  // Four hops away: refused.
  const far = await world.identity(); world.host(hosts[A], far); const v2 = fx.verifier(); await fx.track(v2, hosts[A], far);
  await world.move(far, hosts[A], hosts[B]); await world.move(far, hosts[B], hosts[C]); await world.move(far, hosts[C], hosts[D]); await world.move(far, hosts[D], hosts[E]);
  const hops = await v2.refresh(origin(hosts[A], far));
  assert.equal(hops.outcome, 'refused'); assert.equal(hops.reason, 'redirect-hops');
  // A cycle: the destination redirects back to an origin already visited.
  const loop = await world.identity(); world.host(hosts[A], loop); await fx.track(registry, hosts[A], loop);
  await world.move(loop, hosts[A], hosts[B]);
  hosts[B].state.set(loop.sub, { status: 'redirect-only', identity: `${B}/identity/${loop.sub}`, location: `${A}/identity/${loop.sub}` });
  const cycle = await registry.refresh(origin(hosts[A], loop));
  assert.equal(cycle.outcome, 'refused'); assert.equal(cycle.reason, 'redirect-cycle');
});

test('presentation intake queues without fetching and is verified in the background; unknown identities are dropped', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]);
  const before = world.net.calls.length;
  const engine = await createTestEngine({ providers: { successors: registry } }); t.after(() => engine.dispose());
  assert.deepEqual(await engine.perform(new PresentSuccessor({ actor: { kind: 'public' }, input: { moves: hosts[B].state.get(id.sub).moves } })), { accepted: true });
  assert.equal(world.net.calls.length, before, 'presentation never fetches on the request path');
  assert.equal(await registry.resolve({ iss: B, sub: id.sub }), null);
  assert.deepEqual(await registry.present({ moves: [{ statement: 'x', attestation: null }] }), { accepted: true }, 'malformed: same answer');
  assert.deepEqual((await registry.drain()).processed, 1);
  assert.equal((await engine.read(new ResolveSuccessor({ actor: { kind: 'system' }, input: { iss: B, sub: id.sub } }))).origin.iss, A);
  await assert.rejects(engine.perform(new ConfirmSuccessor({ actor: { kind: 'system' }, input: { origin: origin(hosts[A], id), digest: 'x' } })), { code: 'forbidden' });
  assert.deepEqual(SUCCESSOR_OPERATIONS.map(op => op.operation).sort(), ['successors.adopt', 'successors.confirm', 'successors.dismiss', 'successors.drain', 'successors.first-contact', 'successors.pending', 'successors.present', 'successors.refresh', 'successors.resolve', 'successors.track']);
  await assert.rejects(engine.perform(new AdoptSuccessor({ actor: { kind: 'public' }, input: { origin: origin(hosts[A], id), moves: [] } })), { code: 'forbidden' });
});

test('flag off: nothing adopted, presentations dropped, the successor index unused', async t => {
  const fx = await setup({ enabled: false }); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]);
  assert.equal((await registry.refresh(origin(hosts[A], id))).outcome, 'disabled');
  assert.equal((await registry.firstContact({ iss: B, sub: id.sub, purpose: 'origin-linking' })).outcome, 'unverified');
  assert.equal(await registry.resolve({ iss: B, sub: id.sub }), null);
  fx.state.enabled = true; assert.equal((await registry.refresh(origin(hosts[A], id))).outcome, 'adopted');
  fx.state.enabled = false; assert.equal(await registry.resolve({ iss: B, sub: id.sub }), null, 'off again: moved identities fail uniformly');
  assert.equal((await registry.resolve({ iss: A, sub: id.sub })).accepts, false);
});

test('item 5: an unreachable source is temporarily unavailable, and treated as gone after 7 days of failures', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await fx.track(registry, hosts[A], id);
  await world.move(id, hosts[A], hosts[B]);
  const record = hosts[A].state.get(id.sub).moved;
  await registry.client.attestationKeys(A); // cached; the source then goes away
  world.net.down.add(A);
  fx.clock.advance(1000);
  // Fresh JWKS is required within the hour: it is cached, so item 3 passes; item 5 cannot be checked yet.
  assert.equal((await registry.adopt(origin(hosts[A], id), [record])).outcome, 'unavailable');
  fx.clock.advance(3 * DAY);
  assert.equal((await registry.adopt(origin(hosts[A], id), [record])).outcome, 'unavailable', 'no fresh attestation keys while the source is down');
  world.net.down.delete(A); await registry.client.attestationKeys(A); hosts[A].extra = request => request.path === '/directory' ? json({ error: 'busy' }, 503) : null;
  fx.clock.advance(5 * DAY);
  assert.equal((await registry.adopt(origin(hosts[A], id), [record])).outcome, 'adopted', 'source treated as gone after 7 days of failed item-5 lookups');
});

test('first contact: deferred without a relationship or linking role; verified only when every record verifies; an unattested chain is a separate identity', async t => {
  const fx = await setup(); t.after(fx.close);
  const { world, hosts, registry } = fx, id = await world.identity();
  world.host(hosts[A], id); await world.move(id, hosts[A], hosts[B]); await world.move(id, hosts[B], hosts[C]);
  const deferred = await registry.firstContact({ iss: C, sub: id.sub });
  assert.equal(deferred.outcome, 'unverified'); assert.equal(deferred.reason, 'deferred'); assert.deepEqual(deferred.origin, { iss: C, sub: id.sub }); assert.deepEqual(deferred.claimedOrigin, { iss: A, sub: id.sub });
  const linked = await registry.firstContact({ iss: C, sub: id.sub, purpose: 'origin-linking' });
  assert.equal(linked.outcome, 'verified'); assert.deepEqual(linked.origin, { iss: A, sub: id.sub });
  assert.deepEqual((await registry.resolve({ iss: C, sub: id.sub })).origin, { iss: A, sub: id.sub });
  // An unattested hop anywhere: never treated as the origin principal.
  const other = await world.identity(); world.host(hosts[A], other); await world.move(other, hosts[A], hosts[B], { attest: false });
  const separate = await fx.verifier().firstContact({ iss: B, sub: other.sub, purpose: 'origin-linking' });
  assert.equal(separate.outcome, 'unverified'); assert.equal(separate.reason, 'unattested'); assert.deepEqual(separate.origin, { iss: B, sub: other.sub });
  // An identity that never moved: keyed by its own (iss, sub).
  const plain = await world.identity(); world.host(hosts[A], plain);
  const unmoved = await registry.firstContact({ iss: A, sub: plain.sub });
  assert.equal(unmoved.outcome, 'unmoved'); assert.equal(unmoved.signing.kid, plain.current.kid);
});

test('the portability client applies the client-metadata fetch policy', async t => {
  assert.equal(portabilityURL('http://a.example/x'), null); assert.equal(portabilityURL('https://localhost/x'), null); assert.equal(portabilityURL('https://10.0.0.1/x'), null);
  assert.equal(portabilityURL('https://a.example:8443/x'), null); assert.equal(portabilityURL('https://u@a.example/x'), null); assert.equal(portabilityURL('https://a.example/x#f'), null);
  assert.ok(portabilityURL('https://a.example/directory?sub=x'));
  const clock = fakeClock(), seen = [];
  const fetch = async (url, init) => { seen.push(init); if (url.endsWith('/manifest.json')) return json({ version: '0', issuer: A, extensions: [{ spec: EXT.directory, options: { directory_url: `${A}/dir` } }, { spec: EXT.portability, options: { move_endpoint: 'https://evil.example/move', attestation_jwks_uri: `${A}/k` } }] }); if (url.includes('/dir')) return new Response('x'.repeat(PORTABILITY_LIMITS.directoryBytes + 1), { status: 200, headers: { 'Content-Type': 'application/json' } }); return json({}, 302, { Location: 'https://evil.example/' }); };
  const client = portabilityClient({ fetch, clock: clock.now, limits: { ...PORTABILITY_LIMITS, perSite: { windowMs: 60000, limit: 3 } } });
  const manifest = await client.manifest(A);
  assert.equal(manifest.status, 'ok'); assert.equal(manifest.portability, null, 'an off-origin feature member makes the feature absent');
  assert.ok(seen.every(init => init.redirect === 'manual' && init.credentials === 'omit'));
  assert.equal((await client.lookup(A, '6f1c2b8e-3d4a-4c5b-9e7f-000000000001')).status, 'invalid', 'an oversized body is refused');
  assert.equal((await client.document(`${A}/identity/x`, {})).status, 'redirect', 'redirects are data, never followed');
  const calls = seen.length;
  await assert.rejects(client.document(`${A}/identity/y`, {}), { code: 'temporarily_unavailable' }, 'the per-site budget is spent before egress');
  assert.equal(seen.length, calls);
  // Adapter egress: every DNS answer must be public.
  const screened = createPortabilityFetch({ fetcher: async () => json({}), resolve: async () => ['10.1.2.3'], publicRouting: true });
  await assert.rejects(screened(`${A}/x`, {}), { code: 'egress_refused' });
  assert.throws(() => createPortabilityFetch({ fetcher: fetch, resolve: async () => [] }), /strictly public/);
});

test('attestation thumbprints are RFC 7638 over the public point only', async () => {
  const fx = await setup(); t => t;
  const key = fx.hosts[A].set.keys[0];
  assert.equal(await attestationKeyThumbprint(key.publicJwk), (await attestationRootThumbprints(fx.hosts[A].set))[0]);
  fx.close();
});
