// Successor-chain byte budget (docs/spec/identity-portability.md §4, §5.3 and §7 "Size"; DEVLOG 2026-10-23 "Successor
// chain byte budget and key tombstone compaction"). Engine-level over the simulated provider network of
// tests/helpers/portability-network.mjs: real statements, attestations, continuity statements and wire formats, the real
// portability client and the `successors.*` operations. The scalability probe measured rotating chains of 15 and 16
// moves refused at a flat 32 KiB; the derived budget must admit 16 legal moves at their worst case and refuse beyond it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { metadataStore, createRandom } from '../packages/app/memory-providers.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { createTestEngine } from './helpers/app-engine.mjs';
import { World } from './helpers/portability-network.mjs';
import { SuccessorRegistry, portabilityClient, PORTABILITY_LIMITS, TrackSuccessor, AdoptSuccessor, ResolveSuccessor } from '../packages/identity/successors.mjs';
import { signMoveStatement, signMoveAttestation, signAttestationKeyContinuity, evaluateAttestationKeys, attestationKeyThumbprint, parseMoveStatement, parseMoveAttestation, moveStatementBytes, statementDigest, MAX_MOVES, MAX_MOVE_URI, MAX_STATEMENT_BYTES, MAX_ATTESTATION_BYTES, MAX_MOVES_DOCUMENT_BYTES, DOCUMENT_BYTES, DOCUMENT_BASE_BYTES, MOVE_ALLOWANCE } from '../packages/identity/succession.mjs';
import { createAttestationKeySet } from '../packages/identity/attestation-keys.mjs';

const ACTOR = { kind: 'system', owner: '00000000-0000-4000-8000-000000000000' };
const bytes = value => Buffer.byteLength(JSON.stringify(value));
/** An issuer origin of 252 characters (the origin cap is 256): DNS labels at the 63 maximum, one registrable domain
 * per host (the client's per-site budget is per registrable domain). */
const longOrigin = i => `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(44 - String(i).length)}${i}.example`;
/** An identity URI of exactly MAX_MOVE_URI characters on `origin`. */
const longIdentity = (origin, sub, n = 1) => { const base = `${origin}/identity/${sub}/r${n}/`; return base + 'p'.repeat(MAX_MOVE_URI - base.length); };

/** A world whose hosts and identity URIs are at their maxima; attestation kids stay short (kids are capped at 128). */
async function worstWorld(count, { short = false } = {}) {
  const clock = fakeClock(Date.UTC(2026, 9, 23, 12)), world = new World({ clock }), hosts = [];
  if (!short) world.identityURI = (provider, identity, n = 1) => longIdentity(provider.origin, identity.sub, n);
  for (let i = 0; i < count; i++) { const host = await world.provider(short ? `https://host${i}.example` : longOrigin(i)); host.config = await createAttestationKeySet({ kid: `a1-h${i}` }); hosts.push(host); }
  return { clock, world, hosts };
}
async function verifierEngine(t, { world, clock }) {
  const db = new SqliteMetadata(':memory:');
  const registry = new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: world.net.fetch, clock: clock.now }), enabled: () => true, clock: clock.now });
  const engine = await createTestEngine({ clock, providers: { successors: registry } });
  t.after(async () => { await engine.dispose(); db.close(); });
  return { registry, engine, perform: action => engine.perform(action), read: query => engine.read(query) };
}

test('budget constants: the derivation holds and the client fetch bound is the budget', () => {
  assert.equal(MOVE_ALLOWANCE, 7488); assert.equal(MAX_MOVES_DOCUMENT_BYTES, DOCUMENT_BASE_BYTES + MAX_MOVES * MOVE_ALLOWANCE); assert.equal(MAX_MOVES_DOCUMENT_BYTES, 152576);
  assert.equal(PORTABILITY_LIMITS.documentBytes, MAX_MOVES_DOCUMENT_BYTES); assert.equal(DOCUMENT_BYTES, DOCUMENT_BASE_BYTES, 'a document without moves holds 16 own keys (review 2026-10-23 item 2)');
  assert.equal(longOrigin(16).length, 252); assert.equal(longIdentity(longOrigin(3), '6f1c2b8e-3d4a-4c5b-9e7f-000000000001').length, MAX_MOVE_URI);
});

test('worst case: a 16-move rotating chain with maximum-length origins and identity URIs is adopted through the real client', async t => {
  const fx = await worstWorld(MAX_MOVES + 1), { world, hosts } = fx, v = await verifierEngine(t, fx);
  const id = await world.identity(), entry = world.host(hosts[0], id), origin = { iss: hosts[0].origin, sub: id.sub };
  await v.perform(new TrackSuccessor({ actor: ACTOR, input: { origin, identity: entry.identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } } }));
  const moves = []; for (let i = 0; i < MAX_MOVES; i++) moves.push(await world.move(id, hosts[i], hosts[i + 1], { rotate: true }));
  for (const record of moves) {
    const s = parseMoveStatement(record.statement).payload;
    assert.equal(s.from.identity.length, MAX_MOVE_URI); assert.equal(s.to.identity.length, MAX_MOVE_URI);
    assert.ok(record.statement.length <= MAX_STATEMENT_BYTES && record.attestation.length <= MAX_ATTESTATION_BYTES);
  }
  const document = hosts[MAX_MOVES].state.get(id.sub).document(), size = bytes(document);
  assert.equal(document.keys.length, MAX_MOVES + 1, 'one rotation per move: 17 chain keys');
  assert.ok(size > 2 * 32768, `the old flat 32 KiB would refuse this chain (${size} bytes)`);
  assert.ok(size <= MAX_MOVES_DOCUMENT_BYTES - DOCUMENT_BASE_BYTES + 4096, `the moves and chain keys fit their per-move allowance (${size} bytes)`);
  const adopted = await v.perform(new AdoptSuccessor({ actor: ACTOR, input: { origin, moves } }));
  assert.equal(adopted.outcome, 'adopted', JSON.stringify(adopted)); assert.equal(adopted.adopted, MAX_MOVES);
  const resolved = await v.read(new ResolveSuccessor({ actor: ACTOR, input: { iss: hosts[MAX_MOVES].origin, sub: id.sub } }));
  assert.deepEqual(resolved.origin, origin); assert.equal(resolved.accepts, true);
});

test('fail closed beyond the budget: a 17th record, an over-length URI, an over-cap record, an over-budget document, an over-size unmoved document', async t => {
  const fx = await worstWorld(MAX_MOVES + 2, { short: true }), { world, hosts } = fx, v = await verifierEngine(t, fx);
  const id = await world.identity(), entry = world.host(hosts[0], id), origin = { iss: hosts[0].origin, sub: id.sub };
  await v.registry.track({ origin, identity: entry.identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
  const moves = []; for (let i = 0; i < MAX_MOVES + 1; i++) moves.push(await world.move(id, hosts[i], hosts[i + 1], { rotate: true }));
  assert.deepEqual(await v.registry.adopt(origin, moves), { outcome: 'refused', reason: 'malformed' }, 'more than 16 records');
  // §4: an identity URI above MAX_MOVE_URI can be neither signed nor parsed.
  const key = id.current, base = { bindle: 'identity-move', v: 1, sub: id.sub, kind: 'person', seq: 1, prev: null, from: { iss: hosts[0].origin, identity: `${hosts[0].origin}/identity/x` }, iat: 1 };
  const long = `${hosts[1].origin}/identity/${'q'.repeat(MAX_MOVE_URI)}`.slice(0, MAX_MOVE_URI + 1);
  await assert.rejects(signMoveStatement({ kid: key.kid, payload: { ...base, to: { iss: hosts[1].origin, identity: long } } }, key.pair.privateKey), { code: 'statement_invalid' });
  const fits = await signMoveStatement({ kid: key.kid, payload: { ...base, to: { iss: hosts[1].origin, identity: long.slice(0, -1) } } }, key.pair.privateKey);
  assert.equal(fits.length, moveStatementBytes({ kid: key.kid, payload: { ...base, to: { iss: hosts[1].origin, identity: long.slice(0, -1) } } }));
  // Per-record caps apply before any signature work: an over-cap compact JWS is refused by the parser.
  assert.throws(() => parseMoveStatement(`${'e'.repeat(MAX_STATEMENT_BYTES)}.e.e`), { code: 'statement_invalid' });
  assert.throws(() => parseMoveAttestation(`${'e'.repeat(MAX_ATTESTATION_BYTES)}.e.e`), { code: 'attestation_invalid' });
  // §7: a destination document above the budget is refused by the fetch bound (destination-document-invalid).
  const id2 = await world.identity(), e2 = world.host(hosts[0], id2), origin2 = { iss: hosts[0].origin, sub: id2.sub };
  await v.registry.track({ origin: origin2, identity: e2.identity, signing: { kid: id2.current.kid, publicJwk: id2.current.pair.publicJwk } });
  const one = await world.move(id2, hosts[0], hosts[1], { rotate: true }), dest = hosts[1].state.get(id2.sub), plain = dest.document;
  dest.document = () => ({ ...plain(), padding: 'z'.repeat(MAX_MOVES_DOCUMENT_BYTES) });
  assert.deepEqual(await v.registry.adopt(origin2, [one]), { outcome: 'refused', reason: 'destination-document-invalid' });
  // Exactly at the budget is accepted (fail closed above, not at, the bound).
  dest.document = () => { const doc = plain(); return { ...doc, padding: 'z'.repeat(MAX_MOVES_DOCUMENT_BYTES - bytes({ ...doc, padding: '' })) }; };
  assert.equal(bytes(dest.document()), MAX_MOVES_DOCUMENT_BYTES);
  assert.equal((await v.registry.adopt(origin2, [one])).outcome, 'adopted');
  // Organizations §3a.3: a document without `moves` stays at 16 KiB.
  const client = portabilityClient({ fetch: world.net.fetch, clock: fx.clock.now }), id3 = await world.identity(), e3 = world.host(hosts[2], id3), doc3 = e3.document;
  e3.document = () => { const doc = doc3(); return { ...doc, padding: 'z'.repeat(DOCUMENT_BYTES - bytes({ ...doc, padding: '' })) }; };
  assert.equal((await client.document(e3.identity, { sub: id3.sub })).status, 'ok');
  e3.document = () => { const doc = doc3(); return { ...doc, padding: 'z'.repeat(DOCUMENT_BYTES + 1 - bytes({ ...doc, padding: '' })) }; };
  assert.equal((await client.document(e3.identity, { sub: id3.sub })).status, 'invalid');
});

test('seeded: the producer size prediction equals every signed statement, and every statement within the URI cap fits its byte cap', async () => {
  const random = createRandom(Number(process.env.CHAOS_SEED ?? 23)), key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  for (let i = 0; i < 64; i++) {
    const iss = (n, p) => `https://${'h'.repeat(1 + random.int(60))}.${String.fromCharCode(97 + random.int(26)).repeat(1 + random.int(n))}${p}.example`;
    const from = iss(60, 'f'), to = iss(60, 't'), path = (o, max) => `${o}/${'s'.repeat(Math.max(1, random.int(max - o.length)))}`;
    const kid = random.chance(0.5) ? 'k'.repeat(1 + random.int(128)) : crypto.randomUUID(), seq = 1 + random.int(MAX_MOVES);
    const payload = { bindle: 'identity-move', v: 1, sub: '6f1c2b8e-3d4a-4c5b-9e7f-000000000001', kind: random.pick(['person', 'organization']), seq, prev: seq === 1 ? null : `sha256-${'A'.repeat(43)}`, from: { iss: from, identity: path(from, MAX_MOVE_URI) }, to: { iss: to, identity: path(to, MAX_MOVE_URI) }, iat: random.chance(0.2) ? Number.MAX_SAFE_INTEGER : 1792400000 + random.int(1e6) };
    const predicted = moveStatementBytes({ kid, payload }), jws = await signMoveStatement({ kid, payload }, key.privateKey);
    assert.equal(jws.length, predicted); assert.ok(predicted <= MAX_STATEMENT_BYTES, `${predicted}`);
    assert.match(await statementDigest(parseMoveStatement(jws).input), /^sha256-/);
  }
});

test('the destination directory and document stay consistent with the budget when a chain is presented one record at a time', async t => {
  // A verifier that follows a worst-case identity move by move (refresh after each) ends with the same pin as one that
  // adopts all 16 at once: each intermediate destination document also fits the budget.
  const fx = await worstWorld(MAX_MOVES + 1), { world, hosts } = fx, v = await verifierEngine(t, fx);
  const id = await world.identity(), entry = world.host(hosts[0], id), origin = { iss: hosts[0].origin, sub: id.sub };
  await v.registry.track({ origin, identity: entry.identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
  for (let i = 0; i < MAX_MOVES; i++) {
    const record = await world.move(id, hosts[i], hosts[i + 1], { rotate: true });
    const adopted = await v.registry.adopt(origin, [record]);
    assert.equal(adopted.outcome, 'adopted', `move ${i + 1}: ${JSON.stringify(adopted)}`);
    assert.ok(bytes(hosts[i + 1].state.get(id.sub).document()) <= MAX_MOVES_DOCUMENT_BYTES);
  }
  const pin = await v.registry.pin(origin); assert.equal(pin.head.seq, MAX_MOVES); assert.equal(pin.chain.length, MAX_MOVES);
  assert.equal(pin.current.identity.length, MAX_MOVE_URI);
});

test('move headers carry printable ASCII kids only: non-ASCII, lone surrogates and controls are refused by parser and signer (review item 5)', async () => {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const payload = { bindle: 'identity-move', v: 1, sub: '6f1c2b8e-3d4a-4c5b-9e7f-000000000001', kind: 'person', seq: 1, prev: null, from: { iss: 'https://a.example', identity: 'https://a.example/identity/x' }, to: { iss: 'https://b.example', identity: 'https://b.example/identity/x' }, iat: 1 };
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), sig = new Uint8Array(64); sig[31] = 1; sig[63] = 1;
  const lowS = Buffer.from(sig).toString('base64url');
  assert.ok(parseMoveStatement(`${b64({ alg: 'ES256', kid: 'ascii-kid', typ: 'bindle-identity-move+jwt' })}.${b64(payload)}.${lowS}`), 'the same JWS with an ASCII kid parses');
  for (const kid of ['ключ', 'k\ud800', 'k\u0085', 'k y', 'é'.repeat(10), 'k'.repeat(129)]) {
    await assert.rejects(signMoveStatement({ kid, payload }, keyPair.privateKey), { code: 'statement_invalid' }, JSON.stringify(kid));
    await assert.rejects(signMoveAttestation({ kid, payload: { bindle: 'move-attestation', v: 1, iss: 'https://a.example', sub: payload.sub, seq: 1, statement: `sha256-${'A'.repeat(43)}`, to: payload.to, aep: 0, at: 1 } }, keyPair.privateKey), { code: 'attestation_invalid' });
    // A hand-built JWS with that kid (signature validity is irrelevant: the header is refused first).
    assert.throws(() => parseMoveStatement(`${b64({ alg: 'ES256', kid, typ: 'bindle-identity-move+jwt' })}.${b64(payload)}.${lowS}`), { code: 'statement_invalid' });
  }
  assert.ok(await signMoveStatement({ kid: '~'.repeat(128), payload }, keyPair.privateKey), 'printable ASCII up to 128 characters');
});

test('attestation-key evaluation verifies each continuity statement at most once per call: 64 listed keys, at most 64 ECDSA verifications (review item 4)', async () => {
  const issuer = 'https://attest.example', keys = [], pairs = [];
  for (let i = 0; i < 32; i++) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk = { kty, crv, x, y, kid: `g${i}`, use: 'sig', alg: 'ES256' };
    if (i) jwk.continuity = await signAttestationKeyContinuity({ kid: `g${i - 1}`, privateKey: pairs[i - 1].privateKey, next: jwk });
    keys.push(jwk); pairs.push(kp);
  }
  // 32 keys whose continuity names the pinned root but signs a different thumbprint: they never verify, so without the
  // memo the closure below re-verified them on every one of its ~32 passes.
  const bad = [];
  for (let i = 0; i < 32; i++) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']), { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk = { kty, crv, x, y, kid: `b${i}`, use: 'sig', alg: 'ES256' };
    jwk.continuity = await signAttestationKeyContinuity({ kid: 'g0', privateKey: pairs[0].privateKey, next: keys[1 + (i % 31)] });
    bad.push(jwk);
  }
  let verifications = 0;
  const counting = { getRandomValues: v => crypto.getRandomValues(v), subtle: new Proxy(crypto.subtle, { get(target, name) { const value = target[name]; if (name === 'verify') return (...args) => { verifications++; return value.apply(target, args); }; return typeof value === 'function' ? value.bind(target) : value; } }) };
  const pins = { [issuer]: { thumbprints: [await attestationKeyThumbprint(keys[0])], firstUse: false } };
  const evaluated = await evaluateAttestationKeys({ issuer, jwks: { keys: [...bad, ...keys.slice(1).reverse(), keys[0]] }, pins }, { crypto: counting });
  assert.equal(evaluated.trusted.length, 32, 'the whole good chain is trusted, no bad key');
  assert.ok(verifications <= 64, `${verifications} verifications`);
  verifications = 0; await evaluateAttestationKeys({ issuer, jwks: { keys: [...bad, ...keys] } }, { crypto: counting });
  assert.ok(verifications <= 64, `first use: ${verifications} verifications`);
});
