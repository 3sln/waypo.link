// PORT-4: identity transfer-in at the destination (packages/identity/transfer-in.mjs, packages/identity/attestation-keys.mjs,
// the keys.mjs custody fence; docs/spec/identity-portability.md rev 3.2 §5.1, §7, §7.1, §9, §12 "Destination", "Rotation at
// activation", "Attestation-key continuity"; design §7, §7.1, §10.3). Engine-level: the real PORT-2 source and PORT-3
// moved hooks on one side, the destination engine on the other, joined by a simulated network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { portabilityPair, destinationFixture, packageFrom, OWNER, DEST, ISSUER, HOUR, DAY, MINUTE } from './helpers/transfer-in.mjs';
import { World, createNetwork, json } from './helpers/portability-network.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { metadataStore } from '../packages/app/memory-providers.mjs';
import { createTestEngine } from './helpers/app-engine.mjs';
import { IdentityKeyRegistry, verifyKeyContinuity, TRANSFER_IN_ROTATION, custodyFence } from '../packages/identity/keys.mjs';
import { verifyChain, parseMoveStatement, statementDigest, signMoveAttestation, attestationKeyThumbprint, verifyMoveStatement } from '../packages/identity/succession.mjs';
import { TRANSFER_IN_OPERATIONS, TRANSFER_IN_INTAKE_OPERATIONS, identityDocument, directoryAnswer, redirectBaseFor, transferInView, TRANSFER_IN_STATES } from '../packages/identity/transfer-in.mjs';
import { createAttestationKeySet, rotateAttestationKeySet, parseAttestationKeySet, verifyAttestationKeySet, publishedAttestationJwks, attestorFromConfig, attestorFromKeySet, removeAttestationKey, attestationRoots, SHIPPED_ATTESTATION_ROOTS } from '../packages/identity/attestation-keys.mjs';
import { attestorFromJwk } from '../packages/identity/transfer-out.mjs';
import { validateRedirectBase } from '../packages/identity/succession.mjs';

const activate = async p => { await p.dest.reserve(p.pkg); await p.dest.begin(p.pkg); p.clock.advance(25 * HOUR); return p.dest.step(); };

test('attested transfer-in end to end: statement, polling, activation, rotation with chained provenance, fresh certification key, moves; a verifier adopts it', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  const tracker = p.verifier();
  await tracker.track({ origin: { iss: ISSUER, sub: OWNER }, identity: `${ISSUER}/identity/${OWNER}`, signing: { kid: 'kid-1', publicJwk: source.signing.publicJwk } });
  assert.deepEqual(await dest.check(p.pkg), { sub: OWNER, kind: 'person', from: p.pkg.from, mode: 'attested', label: null });
  const reserved = await dest.reserve(p.pkg); assert.equal(reserved.mode, 'attested'); assert.match(reserved.handle, /^n\./);
  assert.equal((await dest.identityRecord()).status, 'pending-transfer');
  const begun = await dest.begin(p.pkg);
  assert.equal(begun.state, 'pending', 'the source holds the 24 h person delay'); assert.equal(begun.sourceBound, true); assert.equal(begun.authorizeUrl, `${ISSUER}/account/transfer-out`);
  const record = await dest.get();
  assert.equal(record.redirectBase, redirectBaseFor(DEST, ISSUER)); validateRedirectBase(record.redirectBase, DEST);
  const statement = parseMoveStatement(record.statement.jws).payload;
  assert.deepEqual([statement.seq, statement.prev, statement.from, statement.to], [1, null, p.pkg.from, { iss: DEST, identity: `${DEST}/identity/${OWNER}` }]);
  assert.equal((await source.get()).statement.digest, record.statement.digest, 'the source bound exactly this statement');
  // Nothing is active before the attestation.
  assert.equal(await dest.document(), null); assert.equal(directoryAnswer({ issuer: DEST, identity: await dest.identity.get(OWNER) }), null);
  p.clock.advance(25 * HOUR);
  assert.deepEqual(await dest.step(), { action: 'active', active: true });
  const sourceRecord = await source.get(); assert.equal(sourceRecord.state, 'committed');
  const done = await dest.get();
  assert.equal(done.state, 'active'); assert.equal(done.attestation, sourceRecord.attestation); assert.equal(done.attestationFirstUse, true);
  assert.deepEqual(Object.keys(done.stages).sort(), ['certification', 'identity', 'recovery', 'rotate']);
  assert.equal((await dest.status()).recoveryRequired, true, 'until an active-account issuance port exists the owner is told');
  // Rotation at activation (P11): the imported key signed a continuity statement naming the new key and is retired.
  const history = await dest.registry.history(OWNER, { purpose: 'signing' }), imported = history.find(k => k.kid === 'kid-1'), current = history.find(k => k.current);
  assert.equal(imported.state, 'retired'); assert.equal(typeof imported.retired, 'number'); assert.equal(current.predecessor, 'kid-1'); assert.equal(current.rotation, TRANSFER_IN_ROTATION);
  assert.equal(await verifyKeyContinuity({ signer: imported, next: current, subject: OWNER }), true);
  // The identity record: active, aep floor above the attested aep, origin principal kept.
  const account = await dest.identityRecord();
  assert.equal(account.status, 'active'); assert.ok(account.security.epoch > sourceRecord.aep); assert.deepEqual(account.origin, { iss: ISSUER, sub: OWNER });
  assert.equal(account.moves.length, 1); assert.equal(account.moves[0].attestation, sourceRecord.attestation);
  // The identity document: `moves`, the full key history with `created`/`retired`, a fresh certification key.
  const doc = await dest.document();
  assert.equal(doc.moves.length, 1); assert.deepEqual(doc.keys.filter(k => k.use === 'sig').map(k => [k.kid, k.state]), [['kid-1', 'retired'], [current.kid, 'active']]);
  const cert = doc.keys.filter(k => k.use === 'cert'); assert.equal(cert.length, 1); assert.equal(cert[0].state, 'active'); assert.notEqual(cert[0].jwk.x, source.signing.publicJwk.x);
  const chain = await verifyChain({ moves: doc.moves, keys: doc.keys.filter(k => k.use === 'sig'), iss: DEST, identity: `${DEST}/identity/${OWNER}`, attestationKeys: async issuer => (await dest.client.attestationKeys(issuer)).jwks });
  assert.deepEqual(chain.origin, { iss: ISSUER, sub: OWNER });
  // A verifier holding the old pin adopts through the source's moved document and the destination's directory.
  const adopted = await tracker.refresh({ iss: ISSUER, sub: OWNER });
  assert.equal(adopted.outcome, 'adopted'); assert.deepEqual((await tracker.resolve({ iss: DEST, sub: OWNER })).origin, { iss: ISSUER, sub: OWNER });
  // Fresh signatures use the current key only: the old key signs nothing honoured (§7.1).
  const signer = await dest.registry.privateKey(OWNER, 'signing'); assert.equal(signer.kid, current.kid);
  // A repeated begin with the same package answers from the record (idempotent), even after the source let go.
  assert.equal((await dest.begin(p.pkg)).state, 'active');
});

test('nothing signs before activation: the custody fence refuses minting, fresh signing, exports and recovery rotation', async t => {
  const p = await portabilityPair(t), { dest } = p;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  for (const work of [() => dest.registry.ensure(OWNER, 'signing'), () => dest.registry.ensure(OWNER, 'encryption'), () => dest.registry.privateKey(OWNER, 'signing'), () => dest.registry.exportPrivate(OWNER, 'signing'), () => dest.registry.rotateForRecovery(OWNER, { always: true }), () => dest.registry.rotate(OWNER, { purpose: 'signing', expectedKid: 'kid-1' }), () => dest.registry.rotateAtActivation(OWNER, { expectedKid: 'kid-1' })])
    await assert.rejects(work(), { code: 'transfer_in_pending' });
  assert.equal((await dest.registry.privateKey(OWNER, 'signing', { transferStatement: true })).kid, 'kid-1', 'only the statement signer');
  assert.equal(await dest.document(), null);
  p.clock.advance(25 * HOUR); await dest.step();
  assert.ok((await dest.registry.ensure(OWNER, 'signing')).kid, 'active: the fence lifts');
});

test('keys.mjs never mints a key for an owner whose identity moved away (PORT-2 flagged guard)', async t => {
  const engine = await createTestEngine(); t.after(() => engine.dispose());
  const registry = new IdentityKeyRegistry({ store: metadataStore(engine.metadata), seal: v => structuredClone(v), open: v => structuredClone(v) });
  assert.ok((await registry.ensure(OWNER, 'signing')).created);
  await engine.metadata.put('transfer-out/v1', { state: 'committed' });
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).publicKey);
  for (const work of [() => registry.ensure(OWNER, 'signing'), () => registry.privateKey(OWNER, 'signing'), () => registry.exportPrivate(OWNER, 'signing'), () => registry.rotateForRecovery(OWNER, { always: true }), () => registry.register(OWNER, { kid: 'x', alg: 'ES256', publicJwk: { kty, crv, x, y } })])
    await assert.rejects(work(), { code: 'identity_moved' });
  await engine.metadata.put('transfer-out/v1', { state: 'pending' });
  assert.equal((await registry.ensure(OWNER, 'signing')).created, false);
  // After custody is destroyed at commit stage 2 the pointer is gone; the marker alone still refuses a fresh key.
  await engine.metadata.delete('signing-key'); await engine.metadata.put('transfer-out/custody-ended-v1', { owner: OWNER, at: 1 });
  await assert.rejects(registry.ensure(OWNER, 'signing'), { code: 'identity_moved' });
  assert.equal(await engine.metadata.get('signing-key'), undefined);
  assert.equal(await engine.metadata.transaction(tx => custodyFence({ get: k => tx.get(k) })), 'identity_moved');
});

test('package and identity checks (§9.1, §9.3): unknown members, mismatched keys, organizations, a reused sub, keys the source does not list', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  await assert.rejects(dest.check({ ...p.pkg, recovery: 'secret' }), { code: 'package_invalid' });
  const other = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).privateKey);
  await assert.rejects(dest.check({ ...p.pkg, keys: { signing: { kid: 'kid-1', jwk: { ...source.signing.privateJwk, d: other.d } } } }), { code: 'package_invalid' });
  await assert.rejects(dest.check({ ...p.pkg, kind: 'organization' }), { code: 'organization_transfer_unavailable' });
  await assert.rejects(dest.check({ ...p.pkg, keys: { signing: { kid: 'kid-1', jwk: other } } }), { code: 'source_key_mismatch' });
  await assert.rejects(dest.check({ ...p.pkg, keys: { signing: { kid: 'kid-9', jwk: source.signing.privateJwk } } }), { code: 'source_key_mismatch' });
  await assert.rejects(dest.check({ ...p.pkg, from: { iss: DEST, identity: `${DEST}/identity/${OWNER}` } }), { code: 'same_provider' });
  // Hosted here already (as an identity of this provider): refused.
  await dest.repository.create({ id: OWNER, assignmentId: 'a1', nameAssignmentId: 'a1', revision: 0, handle: 'n.native', status: 'active', security: { epoch: 0, changedAt: 0 }, credentials: [], sessions: [] });
  await assert.rejects(dest.check(p.pkg), { code: 'sub_in_use' });
  await assert.rejects(dest.reserve(p.pkg), { code: 'sub_in_use' });
  // Flag off: no intake at all.
  dest.state.flags.enabled = false; await assert.rejects(dest.check(p.pkg), { code: 'not_found' });
  assert.deepEqual(TRANSFER_IN_OPERATIONS.map(o => o.operation).sort(), ['transfer-in.begin', 'transfer-in.cancel', 'transfer-in.status', 'transfer-in.step']);
  assert.deepEqual(TRANSFER_IN_INTAKE_OPERATIONS.map(o => o.operation).sort(), ['transfer-in.check', 'transfer-in.reserve']);
});

test('a begin must match its reservation, and only the trusted adapter or the enrolled owner can begin', async t => {
  const p = await portabilityPair(t), { dest } = p;
  await assert.rejects(dest.begin(p.pkg), { code: 'reservation_mismatch' }, 'no reservation');
  await dest.reserve(p.pkg);
  await assert.rejects(dest.begin(p.pkg, 'package', { kind: 'public', owner: OWNER }), { code: 'unauthorized' });
  assert.equal((await dest.begin(p.pkg, 'package', { kind: 'intake', owner: OWNER })).state, 'pending');
});

test('the source refuses (cancelled at the source): custody destroyed, reservation released, a new reservation possible', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  await source.cancel();
  p.clock.advance(25 * HOUR);
  const outcome = await dest.step();
  assert.equal(outcome.action, 'refused');
  assert.equal((await dest.get()).reason, 'source-refused');
  assert.equal(await dest.metadata.get('signing-key'), undefined, 'no private key kept');
  assert.equal((await dest.identityRecord()).status, 'transfer-released');
  await assert.rejects(dest.registry.ensure(OWNER, 'signing'), { code: 'transfer_in_pending' }, 'never-activated: nothing minted');
  // The owner starts again at the source; the same sub is reserved again.
  source.clock.advance(DAY); await source.restartChoice('keep'); await source.start();
  const fresh = packageFrom(source, await source.get());
  assert.equal((await dest.reserve(fresh)).mode, 'attested');
  assert.equal((await dest.begin(fresh)).state, 'pending');
});

test('cancel before the source binds the statement; once bound, the owner cancels at the source', async t => {
  const p = await portabilityPair(t), { dest } = p;
  p.served.moveDown = true;
  await dest.reserve(p.pkg);
  const posting = await dest.begin(p.pkg);
  assert.equal(posting.state, 'posting'); assert.equal(posting.sourceBound, false);
  assert.equal((await dest.cancel()).state, 'cancelled');
  assert.equal((await dest.identityRecord()).status, 'transfer-released');
  const q = await portabilityPair(t, { seed: 2 });
  await q.dest.reserve(q.pkg); await q.dest.begin(q.pkg);
  await assert.rejects(q.dest.cancel(), { code: 'cancel_at_source' });
});

test('polling backs off while the source is unavailable and resumes; a source answering 503 never strands a committed move', async t => {
  const p = await portabilityPair(t), { dest, source } = p;
  await dest.reserve(p.pkg); await dest.begin(p.pkg);
  p.clock.advance(25 * HOUR); p.served.moveDown = true;
  // The source commits on its own step while the destination cannot reach it.
  await source.step(); assert.equal((await source.get()).state, 'committed');
  const held = await dest.step(); assert.equal(held.action, 'pending'); assert.ok(held.wakeAt > p.clock.now());
  p.served.moveDown = false; p.clock.advance(HOUR);
  assert.equal((await dest.step()).action, 'active', 'the idempotent move endpoint returns the same attestation');
  assert.equal((await dest.get()).attestation, (await source.get()).attestation);
});

test('an attestation that does not chain to the pinned or preconfigured root holds activation (attestation reset)', async t => {
  const p = await portabilityPair(t, { roots: { [ISSUER]: ['A'.repeat(43)] } }), { dest } = p;
  await activate(p);
  const record = await dest.get();
  assert.equal(record.state, 'held'); assert.equal(record.reason, 'attestation-reset');
  assert.equal((await dest.identityRecord()).status, 'pending-transfer'); assert.equal(await dest.document(), null);
  assert.ok(dest.logs.some(entry => entry.action === 'attestation-reset'));
  await assert.rejects(dest.cancel(), { code: 'cancel_at_source' }, 'a committed source must not be abandoned');
  p.clock.advance(2 * HOUR); assert.equal((await dest.step()).action, 'held');
});

test('a recovery port issues the destination\'s own recovery file at activation', async t => {
  const issued = [];
  const p = await portabilityPair(t, { recovery: { issue: async owner => { issued.push(owner); return { ok: true }; } } });
  await activate(p);
  assert.deepEqual(issued, [OWNER]); assert.equal((await p.dest.status()).recoveryRequired, false);
});

test('unattested transfer-in: only from a file, refused while the source declares portability.v1 or serves the identity, labelled, keyed by its own (iss, sub) and re-checked before activation', async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 22)), net = createNetwork(), world = new World({ net, clock });
  const dead = await world.provider('https://dead.example', { portability: false }), live = await world.provider('https://live.example');
  const id = await world.identity({ sub: OWNER }); world.host(dead, id);
  const dest = await destinationFixture(t, { net, clock });
  const pkg = { bindle: 'identity-package', v: 1, sub: OWNER, kind: 'person', from: { iss: dead.origin, identity: dead.state.get(OWNER).identity }, keys: { signing: { kid: id.current.kid, jwk: id.current.pair.privateJwk } } };
  // The source (no portability.v1) still serves the identity: refused (IP-R1-M7).
  await assert.rejects(dest.check(pkg, 'file'), { code: 'source_still_active' });
  // The source is gone: allowed from a 3sln-format file only.
  net.down.add(dead.origin);
  await assert.rejects(dest.check(pkg), { code: 'unattested_requires_file' });
  await assert.rejects(dest.check({ ...pkg, transfer: { id: 'x'.repeat(24), exp: 1 } }, 'file'), { code: 'source_cannot_attest' });
  const checked = await dest.check(pkg, 'file'); assert.equal(checked.mode, 'unattested'); assert.equal(checked.label, 'moved without confirmation from dead.example');
  await dest.reserve(pkg, 'file');
  // Back before the begin: the begin's own check refuses.
  net.down.delete(dead.origin);
  await assert.rejects(dest.begin(pkg, 'file'), { code: 'source_still_active' });
  // Gone at the begin, back before activation (continuation paused by the kill switch): refused at the re-check.
  net.down.add(dead.origin); dest.state.flags.background = false;
  assert.equal((await dest.begin(pkg, 'file')).state, 'decided');
  net.down.delete(dead.origin); dest.state.flags.background = true;
  assert.equal((await dest.step()).action, 'refused'); assert.equal((await dest.get()).reason, 'source-active');
  assert.equal((await dest.identityRecord()).status, 'transfer-released');
  // A live portability source is never bypassed: attested only.
  const id2 = await world.identity({ sub: '6f1c2b8e-3d4a-4c5b-9e7f-0a1b2c3d4e5f' }); world.host(live, id2);
  const pkg2 = { ...pkg, sub: id2.sub, from: { iss: live.origin, identity: live.state.get(id2.sub).identity }, keys: { signing: { kid: id2.current.kid, jwk: id2.current.pair.privateJwk } } };
  assert.equal((await dest.check(pkg2, 'file')).mode, 'attested');
  // Activation of an unattested identity: source gone again.
  net.down.add(dead.origin);
  await dest.reserve(pkg, 'file');
  const view = await dest.begin(pkg, 'file');
  assert.equal(view.state, 'active'); assert.equal(view.label, 'moved without confirmation from dead.example');
  const account = await dest.identityRecord();
  assert.deepEqual(account.origin, { iss: DEST, sub: OWNER }, 'never presented as the origin principal');
  assert.equal(account.moves[0].attestation, null); assert.equal(account.transferIn.label, 'moved without confirmation from dead.example');
  const doc = await dest.document(); assert.equal(doc.moves[0].attestation, null);
  const current = (await dest.registry.history(OWNER, { purpose: 'signing' })).find(k => k.current); assert.equal(current.predecessor, id.current.kid, 'rotated even when unattested');
  // A verifier never adopts it automatically; its first contact keys it by the current (iss, sub).
  const verifier = new (await import('../packages/identity/successors.mjs')).SuccessorRegistry({ store: metadataStore(dest.metadata), client: dest.client, enabled: () => true, clock: clock.now });
  const first = await verifier.firstContact({ iss: DEST, sub: OWNER, purpose: 'origin-linking' });
  assert.equal(first.outcome, 'unverified'); assert.deepEqual(first.origin, { iss: DEST, sub: OWNER });
});

test('returns to this provider and displacement of an unattested identity are classified per spec §9.3, then refused in this slice', async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 22)), net = createNetwork(), world = new World({ net, clock });
  const a = await world.provider('https://a.example');
  const dest = await destinationFixture(t, { net, clock });
  // Displacement: an attested package for a sub hosted here unattested.
  const id = await world.identity({ sub: OWNER }); world.host(a, id);
  await dest.repository.create({ id: OWNER, assignmentId: 'a1', nameAssignmentId: 'a1', revision: 0, handle: 'n.squat', status: 'active', transferIn: { mode: 'unattested' }, security: { epoch: 1, changedAt: 0 }, credentials: [], sessions: [] });
  const pkg = { bindle: 'identity-package', v: 1, sub: OWNER, kind: 'person', from: { iss: a.origin, identity: a.state.get(OWNER).identity }, keys: { signing: { kid: id.current.kid, jwk: id.current.pair.privateJwk } } };
  await assert.rejects(dest.check(pkg), { code: 'displacement_unsupported' });
  // Return: this provider's own moved-out record is the first record of the source's chain.
  const net2 = createNetwork(), world2 = new World({ net: net2, clock });
  const home = await world2.provider(DEST), b = await world2.provider('https://b.example');
  const back = await world2.identity({ sub: OWNER }); world2.host(home, back);
  const out = await world2.move(back, home, b);
  const dest2 = await destinationFixture(t, { net: net2, clock });
  // The fixture replaced DEST's handler: restore the JWKS so the source's chain verifies, keeping the destination routes.
  const handler = net2.handlers.get(DEST); net2.register(DEST, async request => request.path === '/attestation-keys' ? json(publishedAttestationJwks(home.set)) : handler(request));
  await dest2.repository.create({ id: OWNER, assignmentId: 'a2', nameAssignmentId: 'a2', revision: 0, handle: 'n.home', status: 'deleted', moved: { statementDigest: await statementDigest(parseMoveStatement(out.statement).input) }, security: { epoch: 1, changedAt: 0 }, credentials: [], sessions: [] });
  const pkg2 = { ...pkg, from: { iss: b.origin, identity: b.state.get(OWNER).identity }, keys: { signing: { kid: back.current.kid, jwk: back.current.pair.privateJwk } } };
  await assert.rejects(dest2.check(pkg2), { code: 'return_unsupported' });
});

test('a source that was itself a destination: seq and prev continue its moves, its key history is published, and a verifier two moves behind adopts both', async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 22)), net = createNetwork(), world = new World({ net, clock });
  const a = await world.provider('https://a.example'), b = await world.provider('https://b.example');
  const id = await world.identity({ sub: OWNER }); world.host(a, id);
  const dest = await destinationFixture(t, { net, clock });
  const verifier = new (await import('../packages/identity/successors.mjs')).SuccessorRegistry({ store: metadataStore((await createTestEngine()).metadata), client: dest.client, enabled: () => true, clock: clock.now });
  await verifier.track({ origin: { iss: a.origin, sub: OWNER }, identity: a.state.get(OWNER).identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
  const first = await world.move(id, a, b); // B rotated at activation: B's doc lists k1 (retired) -> k2 (active)
  // B is a cooperative source: it attests the destination's statement at once.
  b.extra = async request => {
    if (request.path !== '/move' || request.method !== 'POST') return null;
    const parsed = parseMoveStatement(request.body.statement), entry = b.state.get(OWNER);
    const attestation = await b.attest({ bindle: 'move-attestation', v: 1, iss: b.origin, sub: OWNER, seq: parsed.payload.seq, statement: await statementDigest(parsed.input), to: parsed.payload.to, aep: 9, at: parsed.payload.iat });
    entry.status = 'moved'; entry.moved = { statement: request.body.statement, attestation };
    return json({ status: 'attested', attestation, redirect_until: null });
  };
  const pkg = { bindle: 'identity-package', v: 1, sub: OWNER, kind: 'person', from: { iss: b.origin, identity: b.state.get(OWNER).identity }, keys: { signing: { kid: id.current.kid, jwk: id.current.pair.privateJwk } }, transfer: { id: 'transfer-id-0123456789', exp: 1 } };
  await dest.reserve(pkg);
  const view = await dest.begin(pkg);
  assert.equal(view.state, 'active');
  const record = await dest.get(), s = parseMoveStatement(record.statement.jws).payload;
  assert.equal(s.seq, 2); assert.equal(s.prev, await statementDigest(parseMoveStatement(first.statement).input));
  const doc = await dest.document();
  assert.equal(doc.moves.length, 2);
  assert.deepEqual(doc.keys.filter(k => k.use === 'sig').map(k => k.state), ['retired', 'retired', 'active'], 'k1 and k2 stay published with the new key');
  assert.ok(doc.keys.filter(k => k.use === 'sig' && k.state === 'retired').every(k => Number.isSafeInteger(k.retired)));
  assert.ok((await dest.identityRecord()).security.epoch >= 10, 'aep floor above the last attested aep');
  const adopted = await verifier.refresh({ iss: a.origin, sub: OWNER });
  assert.equal(adopted.outcome, 'adopted'); assert.equal(adopted.adopted, 2); assert.equal(adopted.current.iss, DEST);
});

test('identity documents and directory answers are uniform for anything not active, and fail closed above the size bound', () => {
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'pending-transfer' }, signing: [] }), null);
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'moved' }, signing: [] }), null);
  assert.equal(directoryAnswer({ issuer: DEST, identity: { id: OWNER, status: 'transfer-released' } }), null);
  const key = { kid: 'k', alg: 'ES256', publicJwk: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) }, state: 'active' };
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active' }, signing: [] }), null, 'exactly one active signing key');
  assert.ok(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active' }, signing: [key] }));
  // Spec §7 "Size": 16 records at their caps fit; a record above its cap, a 17th record or a document above the budget
  // is never published (the uniform 404).
  const capped = Array.from({ length: 16 }, () => ({ statement: 's'.repeat(3072), attestation: 'a'.repeat(2560) }));
  assert.ok(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active', moves: capped }, signing: [key] }));
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active', moves: [...capped.slice(1), { statement: 's'.repeat(3073), attestation: null }] }, signing: [key] }), null);
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active', moves: [...capped, capped[0]] }, signing: [key] }), null);
  assert.equal(identityDocument({ issuer: DEST, identity: { id: OWNER, status: 'active', handle: 'h'.repeat(153000), moves: capped }, signing: [key] }), null);
  assert.deepEqual(transferInView(null), { state: 'none' }); assert.ok(TRANSFER_IN_STATES.includes('held'));
});

test('P16 attestation key set: chained rotation, removal, a new root, legacy single key, and the attestor refusing an unverifiable set', async () => {
  let config = await createAttestationKeySet({ kid: 'r1' });
  config = await rotateAttestationKeySet(config, { kid: 'r2' }); config = await rotateAttestationKeySet(config, { kid: 'r3' });
  const set = parseAttestationKeySet(config);
  assert.deepEqual(set.keys.map(k => [k.kid, Boolean(k.d), k.continuity?.kid ?? null]), [['r1', false, null], ['r2', false, 'r1'], ['r3', true, 'r2']], 'only the current key keeps d');
  assert.equal((await verifyAttestationKeySet(set)).ok, true);
  const jwks = publishedAttestationJwks(set);
  assert.ok(jwks.keys.every(k => k.use === 'sig' && k.alg === 'ES256' && !('d' in k))); assert.equal(jwks.keys[1].continuity.kid, 'r1');
  // A compromised key is removed; the key it vouched for is an orphan that pinned verifiers keep trusting.
  const removed = parseAttestationKeySet(removeAttestationKey(config, 'r1'));
  assert.deepEqual((await verifyAttestationKeySet(removed)).orphans, ['r2']); assert.equal((await verifyAttestationKeySet(removed)).ok, true);
  assert.throws(() => removeAttestationKey(config, 'r3'), /Rotate away/);
  // A forged continuity never signs.
  const forged = structuredClone(config); forged.keys[2].continuity.sig = forged.keys[1].continuity.sig;
  const attestor = attestorFromConfig(forged); assert.ok(attestor);
  await assert.rejects(attestor.sign({ bindle: 'move-attestation', v: 1, iss: ISSUER, sub: OWNER, seq: 1, statement: `sha256-${'A'.repeat(43)}`, to: { iss: DEST, identity: `${DEST}/identity/${OWNER}` }, aep: 1, at: 1 }), { code: 'attestation_keys_invalid' });
  // Structural refusals: a continuity signer listed later, duplicate points, no current d.
  assert.equal(parseAttestationKeySet({ ...config, keys: [config.keys[1], config.keys[0], config.keys[2]] }), null);
  assert.equal(parseAttestationKeySet({ ...config, current: 'r1' }), null);
  assert.equal(parseAttestationKeySet({ ...config, keys: [...config.keys, { ...config.keys[2], kid: 'dup' }] }), null);
  // The legacy single JWK is a one-key root set; attestorFromJwk (PORT-2 callers) uses the key set.
  const legacy = parseAttestationKeySet({ kid: 'r3', jwk: config.keys[2].jwk }); assert.equal(legacy.current, 'r3'); assert.equal(legacy.keys.length, 1);
  const signed = await attestorFromJwk({ kid: 'r3', jwk: config.keys[2].jwk }).sign({ bindle: 'move-attestation', v: 1, iss: ISSUER, sub: OWNER, seq: 1, statement: `sha256-${'A'.repeat(43)}`, to: { iss: DEST, identity: `${DEST}/identity/${OWNER}` }, aep: 1, at: 1 });
  assert.equal(signed.split('.').length, 3); assert.equal(attestorFromJwk(null), null); assert.equal(attestorFromJwk('{bad'), null);
  // Verifier roots: shipped, configured and this provider's own.
  const roots = await attestationRoots({ issuer: DEST, set, configured: { 'https://partner.example': ['p'] } });
  assert.deepEqual(roots['https://3sln.me'], SHIPPED_ATTESTATION_ROOTS['https://3sln.me']); assert.deepEqual(roots['https://partner.example'], ['p']); assert.equal(roots[DEST].length, 1);
  assert.equal(roots[DEST][0], await attestationKeyThumbprint(set.keys[0].publicJwk));
});
