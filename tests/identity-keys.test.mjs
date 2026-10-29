// Engine-level tests of the core identity key registry (packages/identity/keys.mjs, slice C0): rotation with
// continuity, revocation, kid lookup after rotation, purpose separation, bounded history, custody, seeded
// concurrency (tests/helpers/chaos.mjs) and the recovery boundary through the Node account runtime. The only purpose is
// signing: the identity encryption key was removed with recovery file v3 (owner approval 2026-10-28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryMessagingStore } from '../packages/core/records.mjs';
import { KEY_PURPOSES, IdentityKeyRegistry, createIdentityKeyEngine, performKeyAction, readKeyQuery, EnsureIdentityKey, RotateIdentityKey, RevokeIdentityKey, RegisterIdentityKey, IdentityKeyByKid, CurrentIdentityKey, IdentityKeyHistory, verifyKeyContinuity, resolveIdentityKey, KEY_HISTORY_LIMIT, verifiableSigningKey } from '../packages/identity/keys.mjs';
import { encryptSecret, decryptSecret } from '../packages/runtime/secrets.mjs';
import { createScheduler, forEachSeed, fakeClock } from './helpers/chaos.mjs';
import { createNodeServer } from '../apps/node/server.mjs';
import { softAuthenticator, signupBody, registerPending } from './helpers/soft-passkey.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', ISSUER = 'https://3sln.example';
const KEK = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const sealing = { seal: value => encryptSecret(value, KEK), open: value => decryptSecret(value, KEK) };
function fixture({ store = new MemoryMessagingStore(), clock = fakeClock(1800000000000), historyLimit } = {}) {
  const engine = createIdentityKeyEngine({ store, ...sealing, clock: clock.now, ...historyLimit ? { historyLimit } : {} });
  const act = (Action, input, owner = OWNER) => performKeyAction(engine, new Action({ owner, input }));
  const ask = (Query, input, owner = OWNER) => readKeyQuery(engine, new Query({ owner, input }));
  const rows = () => store.transaction(tx => tx.list(''));
  return { engine, keys: engine.identityKeys, store, clock, act, ask, rows };
}
const code = c => ({ code: c });
const signWith = async (privateKey, bytes) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes));
const verifyWith = async (publicJwk, signature, bytes) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), signature, bytes);

test('ensure is idempotent per purpose and the engine reports changes on engineFeed', async () => {
  const f = fixture(), events = [];
  f.engine.container.feed.addEventListener('identity-keys-changed', event => events.push(event.detail));
  const first = await f.act(EnsureIdentityKey, { purpose: 'signing' }), again = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  assert.equal(first.created, true); assert.deepEqual(again, { kid: first.kid, created: false });
  await assert.rejects(f.act(EnsureIdentityKey, { purpose: 'encryption' }), code('invalid_purpose'), 'the encryption purpose was removed');
  const current = await f.ask(CurrentIdentityKey, { purpose: 'signing' });
  assert.equal(current.kid, first.kid); assert.equal(current.current, true); assert.equal(current.alg, 'ES256'); assert.deepEqual(Object.keys(current.publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.deepEqual(KEY_PURPOSES, ['signing']);
  assert.deepEqual(events.map(e => e.purpose), ['signing', 'signing']);
  await assert.rejects(f.act(EnsureIdentityKey, { purpose: 'delegate' }), code('invalid_purpose'));
});

test('signing rotation: the old key signs the new one, kid lookup still finds the retired key, stored artifacts survive', async () => {
  const f = fixture();
  const { kid: oldKid } = await f.act(EnsureIdentityKey, { purpose: 'signing' }), oldSigner = await f.keys.privateKey(OWNER, 'signing');
  // A provider-stored artifact signed before the rotation (the legacy contact-grant fixture left the core with messaging
  // on 2026-10-27; stored link metas verify the same way, through verifiableSigningKey).
  const input = new TextEncoder().encode('stored artifact'), signature = await signWith(oldSigner.privateKey, input);
  const verifies = async () => { const record = await f.store.transaction(tx => verifiableSigningKey(tx, OWNER, oldKid)); return Boolean(record && await verifyWith(record.publicJwk, signature, input)); };
  assert.equal(await verifies(), true);
  await assert.rejects(f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: 'stale' }), code('key_conflict'));
  const rotated = await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: oldKid });
  assert.equal(rotated.previous, oldKid); assert.notEqual(rotated.kid, oldKid);
  const old = await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: oldKid }), next = await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: rotated.kid });
  assert.equal(old.state, 'retired'); assert.equal(old.current, false); assert.equal(old.verifiable, true); assert.equal(old.successor, rotated.kid);
  assert.equal(next.current, true); assert.equal(next.predecessor, oldKid); assert.equal(next.continuity.kid, oldKid);
  assert.equal(await verifyKeyContinuity({ signer: old, next }), true);
  assert.equal(await verifyKeyContinuity({ signer: next, next }), false, 'the new key cannot vouch for itself');
  assert.equal((await f.keys.privateKey(OWNER, 'signing')).kid, rotated.kid);
  assert.equal(await verifies(), true, 'provider-stored artifacts signed before rotation stay valid');
  assert.deepEqual((await f.ask(IdentityKeyHistory, { purpose: 'signing' })).map(k => [k.kid, k.state]), [[oldKid, 'retired'], [rotated.kid, 'active']]);
  // Tampering with any bound field breaks continuity.
  for (const change of [{ kid: crypto.randomUUID() }, { predecessor: crypto.randomUUID() }, { publicJwk: old.publicJwk }, { purpose: 'certification' }]) assert.equal(await verifyKeyContinuity({ signer: old, next: { ...next, ...change } }), false);
  const forged = { ...next.continuity, signature: Buffer.from(await signWith(oldSigner.privateKey, new TextEncoder().encode(`${next.continuity.kid}.${next.continuity.payload}`))).toString('base64url') };
  assert.equal(await verifyKeyContinuity({ signer: old, next: { ...next, continuity: forged } }), false, 'the continuity domain prefix is required');
});

test('revocation is monotonic, stops stored artifacts verifying, and revoking the current key clears it', async () => {
  const f = fixture();
  const { kid: k0 } = await f.act(EnsureIdentityKey, { purpose: 'signing' }), { kid: k1 } = await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: k0 });
  await assert.rejects(f.act(RevokeIdentityKey, { purpose: 'signing', kid: k0, reason: 'because' }), code('invalid_key'));
  await assert.rejects(f.act(RevokeIdentityKey, { purpose: 'signing', kid: 'missing' }), code('not_found'));
  await assert.rejects(f.act(RevokeIdentityKey, { purpose: 'encryption', kid: k0 }), code('invalid_purpose'));
  const revoked = await f.act(RevokeIdentityKey, { purpose: 'signing', kid: k0, reason: 'compromise' });
  assert.equal(revoked.state, 'revoked'); assert.equal(revoked.verifiable, false);
  assert.equal((await f.act(RevokeIdentityKey, { purpose: 'signing', kid: k0 })).revokedAt, revoked.revokedAt, 'idempotent');
  assert.equal(await f.store.transaction(tx => verifiableSigningKey(tx, OWNER, k0)), null, 'a revoked key verifies no stored artifact');
  await assert.rejects(f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: k0 }), code('key_conflict'));
  await f.act(RevokeIdentityKey, { purpose: 'signing', kid: k1 });
  assert.equal(await f.keys.privateKey(OWNER, 'signing'), null); assert.equal(await f.ask(CurrentIdentityKey, { purpose: 'signing' }), null);
  assert.equal((await f.rows()).some(row => row.key === 'signing-key'), false, 'the revoked private key is dropped');
  const replacement = await f.act(EnsureIdentityKey, { purpose: 'signing' }), described = await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: replacement.kid });
  assert.equal(replacement.created, true); assert.equal(described.predecessor, null); assert.equal(described.continuity, null, 'a revoked key never vouches for its replacement');
  assert.equal((await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: k1 })).state, 'revoked', 'never resurrected');
  // Revoking the replacement through the registry (formerly the legacy ContactTokenService delegate).
  await f.act(RevokeIdentityKey, { purpose: 'signing', kid: replacement.kid }); assert.equal((await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: replacement.kid })).verifiable, false);
});

test('purposes are checked: lookups, private-key usages and registry prefixes are signing-only', async () => {
  const f = fixture();
  const { kid: s } = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  await assert.rejects(f.ask(IdentityKeyByKid, { purpose: 'encryption', kid: s }), code('invalid_purpose'));
  await assert.rejects(f.ask(IdentityKeyByKid, { kid: s }), code('invalid_purpose'));
  await assert.rejects(f.keys.privateKey(OWNER, 'encryption'), code('invalid_purpose'));
  const signer = await f.keys.privateKey(OWNER, 'signing');
  assert.deepEqual(signer.privateKey.usages, ['sign']); assert.equal(signer.privateKey.extractable, false);
  const rows = await f.rows();
  assert.deepEqual(rows.filter(row => row.key.startsWith('contact-key/')).map(row => row.value.kid), [s]);
  assert.deepEqual(rows.filter(row => /^(identity-encryption-key\/|encryption-key|identity-key-retained\/|identity-key-recovery\/)/.test(row.key)), [], 'no encryption key or recovery binding is ever written');
  assert.equal(typeof f.keys.exportPrivate, 'undefined', 'no private key export path exists');
  // Another owner's lookups never see this owner's keys, and a pointer bound to another owner is refused.
  assert.equal(await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: s }, OTHER), null);
  await assert.rejects(f.keys.privateKey(OTHER, 'signing'), code('forbidden'));
  await assert.rejects(f.act(EnsureIdentityKey, { purpose: 'signing' }, OTHER), code('forbidden'));
});

test('custody: private keys exist only sealed; public records and descriptors carry no private member', async () => {
  const f = fixture();
  const { kid: s0 } = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: s0 });
  const pointer = (await f.rows()).find(row => row.key === 'signing-key').value, secret = (await decryptSecret(pointer.encrypted, KEK)).d;
  const serialized = JSON.stringify(await f.rows());
  assert.equal(serialized.includes(secret), false);
  assert.equal(/"d":/.test(serialized), false);
  for (const described of await f.ask(IdentityKeyHistory, { purpose: 'signing' })) assert.equal(JSON.stringify(described).includes('"d"'), false);
  // Without sealing the registry refuses private-key work rather than storing plaintext.
  const bare = new IdentityKeyRegistry({ store: new MemoryMessagingStore() });
  await assert.rejects(bare.ensure(OWNER, 'signing'), code('identity_keys_unavailable'));
  // Legacy registration strips everything but the public coordinates and refuses private material.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await assert.rejects(f.act(RegisterIdentityKey, { kid: 'legacy', alg: 'ES256', publicJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }), code('invalid_key'));
  await f.act(RegisterIdentityKey, { kid: 'legacy', alg: 'ES256', publicJwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), extra: 'x' } });
  assert.deepEqual(Object.keys((await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'legacy' })).publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
});

test('history is bounded: signing prunes revoked then retired records', async () => {
  const f = fixture({ historyLimit: 3 });
  let { kid } = await f.act(EnsureIdentityKey, { purpose: 'signing' }); const first = kid;
  ({ kid } = await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: kid }));
  await f.act(RevokeIdentityKey, { purpose: 'signing', kid: first });
  for (let i = 0; i < 4; i++) ({ kid } = await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: kid }));
  const history = await f.ask(IdentityKeyHistory, { purpose: 'signing' });
  assert.equal(history.length, 3); assert.equal(history.at(-1).kid, kid); assert.equal(history.at(-1).current, true);
  assert.equal(history.some(k => k.kid === first), false, 'the revoked record went first');
  assert.equal(KEY_HISTORY_LIMIT >= 2, true);
});

test('a legacy signing pointer without a public record is backfilled once; an orphaned active record retires on replacement; legacy encryption rows are ignored', async () => {
  const f = fixture(), pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await f.store.transaction(async tx => { await tx.set('signing-key', { kid: 'legacy-s', encrypted: await encryptSecret(await crypto.subtle.exportKey('jwk', pair.privateKey), KEK) }); await tx.set('encryption-key', { kid: 'legacy-e', encrypted: 'x' }); });
  assert.equal(await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'legacy-s' }), null);
  assert.deepEqual(await f.act(EnsureIdentityKey, { purpose: 'signing' }), { kid: 'legacy-s', created: false });
  const backfilled = await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'legacy-s' });
  assert.equal(backfilled.current, true); assert.equal(backfilled.publicJwk.x, (await crypto.subtle.exportKey('jwk', pair.publicKey)).x);
  await f.store.transaction(tx => tx.delete('signing-key'));
  const fresh = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  assert.equal((await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'legacy-s' })).state, 'retired');
  assert.equal((await f.ask(IdentityKeyHistory, { purpose: 'signing' })).filter(k => k.state === 'active').map(k => k.kid).join(), fresh.kid);
});

test('verification lookup: same-host resolves locally, other issuers only through the directory hook', async () => {
  const f = fixture(), { kid } = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  const local = (subject, k, purpose) => f.ask(IdentityKeyByKid, { purpose, kid: k }, subject);
  assert.equal((await resolveIdentityKey({ issuer: ISSUER, subject: OWNER, kid }, { issuer: ISSUER, local })).kid, kid);
  await assert.rejects(resolveIdentityKey({ issuer: ISSUER, subject: OWNER, kid, purpose: 'encryption' }, { issuer: ISSUER, local }), code('invalid_purpose'));
  assert.equal(await resolveIdentityKey({ issuer: 'https://peer.example', subject: OWNER, kid }, { issuer: ISSUER, local }), null, 'no directory: unverifiable');
  const directory = { resolve: async ({ kid: k, purpose }) => ({ kid: k, purpose: purpose === 'signing' ? 'certification' : purpose, alg: 'ES256' }) };
  assert.equal(await resolveIdentityKey({ issuer: 'https://peer.example', subject: OWNER, kid }, { issuer: ISSUER, local, directory }), null, 'a directory answer for another purpose is refused');
  const honest = { resolve: async ({ kid: k, purpose }) => ({ kid: k, purpose, alg: 'ES256' }) };
  assert.equal((await resolveIdentityKey({ issuer: 'https://peer.example', subject: OWNER, kid: 'p1' }, { issuer: ISSUER, local, directory: honest })).kid, 'p1');
});

test('seeded concurrency: rotations, revocation and ensure interleave without two current keys or stale continuity', async () => {
  await forEachSeed(25, async random => {
    const scheduler = createScheduler(random), store = new MemoryMessagingStore(), f = fixture({ store: scheduler.wrap(store, 'store') });
    const { kid: s0 } = await f.keys.ensure(OWNER, 'signing');
    const results = await scheduler.run([
      () => f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: s0 }),
      () => f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: s0 }),
      () => f.act(RevokeIdentityKey, { purpose: 'signing', kid: s0, reason: 'compromise' }),
      () => f.act(EnsureIdentityKey, { purpose: 'signing' }),
      () => f.ask(IdentityKeyByKid, { purpose: 'signing', kid: s0 }),
    ]);
    for (const result of results) if (result.status === 'rejected') assert.ok(['key_conflict', 'not_found', 'identity_keys_unavailable'].includes(result.reason?.code), String(result.reason?.stack ?? result.reason));
    assert.ok(results.slice(0, 2).filter(r => r.status === 'fulfilled').length <= 1, 'one rotation per expected kid');
    assert.equal((await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: s0 })).state, 'revoked', 'revocation always lands');
    for (const purpose of ['signing']) {
      const history = await f.ask(IdentityKeyHistory, { purpose }), current = await f.ask(CurrentIdentityKey, { purpose }), active = history.filter(k => k.state === 'active');
      assert.ok(active.length <= 1); assert.equal(active[0]?.kid ?? null, current?.kid ?? null, 'the only active record is the pointer');
      const pointer = await f.keys.privateKey(OWNER, purpose); assert.equal(pointer?.kid ?? null, current?.kid ?? null);
      for (const next of history.filter(k => k.continuity)) {
        const signer = await f.ask(IdentityKeyByKid, { purpose: 'signing', kid: next.continuity.kid });
        assert.equal(await verifyKeyContinuity({ signer, next, subject: OWNER }), signer.state !== 'revoked', 'a revoked signer vouches for nothing');
      }
    }
    const committed = new Set((await store.transaction(tx => tx.list(''))).map(row => row.value?.kid).filter(Boolean));
    for (const result of results.slice(0, 2)) if (result.status === 'fulfilled') assert.ok(committed.has(result.value.kid));
  });
});

// Recovery boundary (docs/3sln/accounts/recovery-identity.md): recovery file v3 holds no keys, so a signing rotation
// never affects the current file, and a recovery never creates, restores or compares keys.
const origin = 'http://localhost:8788', challenge = 'local-browser-test-token';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function runtime(t) {
  const directory = await mkdtemp(join(tmpdir(), 'identity-keys-runtime-')), app = await createNodeServer({ directory, config: {} });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, input) => { const response = await app.fetch(new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); return { status: response.status, value: await response.json() }; };
  const send = async (path, input) => (await request(path, input)).value;
  const pending = await send('/api/auth/signup', signupBody({ ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: challenge }));
  await registerPending(softAuthenticator({ origin }), send, pending);
  const file = (await request('/api/auth/recovery/download', { pendingToken: pending.pendingToken })).value;
  assert.equal((await request('/api/auth/recovery/confirm', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true })).status, 200);
  const id = pending.account.id, recover = () => request('/api/auth/recover', { recoveryToken: file.recoveryToken, turnstileToken: challenge });
  return { id, controller: app.resources.accounts.get(id), recover };
}
test('a signing rotation leaves the current recovery file usable; recovery never changes keys; lookups report the retired key', async t => {
  const r = await runtime(t), before = await r.controller.signingKey(r.id);
  const rotated = await r.controller.rotateIdentityKey(r.id, { purpose: 'signing', expectedKid: before.kid });
  const keys = digest(await r.controller.identityKeyHistory(r.id, { purpose: 'signing' }));
  assert.equal((await r.recover()).status, 200, 'files are independent of keys');
  assert.equal(digest(await r.controller.identityKeyHistory(r.id, { purpose: 'signing' })), keys, 'a recovery never changes keys');
  assert.deepEqual(await r.controller.identitySigningKey(r.id, before.kid).then(k => [k.active, k.state]), [false, 'retired']);
  assert.deepEqual(await r.controller.identitySigningKey(r.id, rotated.kid).then(k => [k.active, k.state]), [true, 'active']);
  assert.equal(await r.controller.identitySigningKey(r.id, 'unknown'), null);
  assert.equal((await r.controller.signingKey(r.id)).kid, rotated.kid);
  assert.equal((await r.controller.identityKeyHistory(r.id, { purpose: 'signing' })).length, 2);
});

test('review regressions: revoke-then-replace at full history, revoked signers, pruned kids, external keys, legacy revoked pointers', async () => {
  // Finding 1: a full signing history still admits the replacement after a revocation.
  const f = fixture({ historyLimit: 2 });
  let { kid: s } = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  ({ kid: s } = await f.act(RotateIdentityKey, { purpose: 'signing', expectedKid: s }));
  await f.act(RevokeIdentityKey, { purpose: 'signing', kid: s, reason: 'compromise' });
  const replacement = await f.act(EnsureIdentityKey, { purpose: 'signing' });
  assert.equal(replacement.created, true); assert.ok(await f.keys.privateKey(OWNER, 'signing'));
  // Finding 2: continuity is refused from a revoked signer, for another subject, or dated after revocation.
  const g = fixture(); const { kid: s0 } = await g.act(EnsureIdentityKey, { purpose: 'signing' }); const { kid: s1 } = await g.act(RotateIdentityKey, { purpose: 'signing', expectedKid: s0 });
  const next = await g.ask(IdentityKeyByKid, { purpose: 'signing', kid: s1 }), old = await g.ask(IdentityKeyByKid, { purpose: 'signing', kid: s0 });
  assert.equal(await verifyKeyContinuity({ signer: old, next, subject: OWNER }), true);
  assert.equal(await verifyKeyContinuity({ signer: old, next, subject: OTHER }), false);
  assert.equal(await verifyKeyContinuity({ signer: { ...old, revokedAt: 0 }, next }), false);
  await g.act(RevokeIdentityKey, { purpose: 'signing', kid: s0, reason: 'compromise' });
  assert.equal(await verifyKeyContinuity({ signer: await g.ask(IdentityKeyByKid, { purpose: 'signing', kid: s0 }), next }), false);
  // Finding 3: a pruned revoked kid can never be registered again.
  const h = fixture({ historyLimit: 2 }), pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  await h.act(RegisterIdentityKey, { kid: 'ext', alg: 'ES256', publicJwk }); await h.act(RevokeIdentityKey, { purpose: 'signing', kid: 'ext', reason: 'compromise' });
  let { kid } = await h.act(EnsureIdentityKey, { purpose: 'signing' }); ({ kid } = await h.act(RotateIdentityKey, { purpose: 'signing', expectedKid: kid }));
  assert.equal(await h.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'ext' }), null, 'pruned');
  await assert.rejects(h.act(RegisterIdentityKey, { kid: 'ext', alg: 'ES256', publicJwk }), code('key_exists'));
  // Finding 5: ensure never relabels an externally registered key or invents a successor.
  const x = fixture(); await x.act(RegisterIdentityKey, { kid: 'external', alg: 'ES256', publicJwk });
  const own = await x.act(EnsureIdentityKey, { purpose: 'signing' }), external = await x.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'external' });
  assert.equal(external.state, 'active'); assert.equal(external.current, false); assert.equal(external.successor, null);
  assert.equal((await x.ask(CurrentIdentityKey, { purpose: 'signing' })).kid, own.kid);
  // Finding 6: a pre-C0 pointer left on a revoked record is dropped and replaced, never signed with.
  const l = fixture(), legacy = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await l.store.transaction(async tx => { await tx.set(`contact-key/${OWNER}/old/`, { owner: OWNER, kid: 'old', alg: 'ES256', publicJwk: await crypto.subtle.exportKey('jwk', legacy.publicKey), active: false }); await tx.set('signing-key', { kid: 'old', encrypted: await encryptSecret(await crypto.subtle.exportKey('jwk', legacy.privateKey), KEK) }); });
  assert.equal(await l.keys.privateKey(OWNER, 'signing'), null);
  const repaired = await l.act(EnsureIdentityKey, { purpose: 'signing' });
  assert.equal(repaired.created, true); assert.notEqual(repaired.kid, 'old'); assert.equal((await l.keys.privateKey(OWNER, 'signing')).kid, repaired.kid);
  assert.equal((await l.ask(IdentityKeyByKid, { purpose: 'signing', kid: 'old' })).state, 'revoked');
});
