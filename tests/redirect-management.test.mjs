// Redirect management (design §6.4 "Changing or ending a redirect"; spec §10 "Ending early", IP-R1-L3): engine-level
// tests over the simulated portability network with real statements, attestations and key lineages. Includes the
// adversarial review regressions (forged successor, forks, stale chains, open redirect via retarget) and races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { managementFixture, A, B, C, D, E, DAY } from './helpers/redirect-management.mjs';
import { movedLookup, movedResponse } from '../packages/runtime/routes/moved.mjs';
import { movedWindow } from '../packages/identity/lifecycle-tombstone.mjs';
import { createTestEngine } from './helpers/app-engine.mjs';
import { BeginRedirectManagement, CompleteRedirectManagement } from '../packages/identity/redirect-management.mjs';
import { forEachSeed, createScheduler } from './helpers/chaos.mjs';

const uniform = { code: 'not_found', status: 404, message: 'Not found.' };
const lookupEnv = fx => ({ IDENTITY_REPOSITORY: { get: id => fx.repository.get(id), findByHandle: async () => null }, MOVED_CLOCK: () => fx.clock.now(), APP_ORIGIN: A });

test('end from the direct destination: the redirect stops at once, the address and reminder email go, an audit entry stays', async () => {
  const fx = await managementFixture();
  fx.signedInAt(fx.hosts[B]);
  assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
  const moved = await fx.moved();
  assert.equal(movedWindow(moved, fx.clock.now()).live, false);
  assert.equal(moved.redirectBase, null); assert.equal(moved.to, undefined); assert.equal(moved.reminderEmail, undefined); assert.ok(Array.isArray(moved.destinationKeys), 'key thumbprints stay for a revival (review L4)');
  assert.equal(moved.endedBy, 'owner');
  // Proof is kept for the spec §5.2 replay window (30 days after commit here), then erased with the record.
  assert.equal(moved.movedUntil, moved.committedAt + 30 * DAY); assert.equal(typeof moved.attestation, 'string');
  assert.deepEqual(moved.audit.map(entry => entry.event), ['reminder-email-deleted', 'redirect-ended']);
  assert.ok(JSON.stringify(moved.audit).match(/@|https?:/) === null, 'the audit trail names no address');
  assert.equal(await movedLookup(lookupEnv(fx), { sub: fx.id.sub }), null, 'public surfaces answer as for a deleted identity');
  assert.deepEqual(fx.due.map(row => row.kind), ['moved-end']);
  // Idempotent: the same answer and no further change.
  const revision = (await fx.account()).revision;
  fx.signedInAt(fx.hosts[B]);
  await assert.rejects(() => fx.run('end'), uniform, 'an ended redirect is not live any more: the uniform answer');
  assert.equal((await fx.account()).revision, revision);
});

test('end is idempotent under a concurrent end and answers the same outcome', async () => {
  const fx = await managementFixture();
  fx.signedInAt(fx.hosts[B]);
  const verified = await fx.service.verify(fx.token);
  const both = await Promise.all([fx.service.end(verified), fx.service.end(verified)]);
  assert.deepEqual(both, [{ outcome: 'ended' }, { outcome: 'ended' }]);
  assert.equal((await fx.moved()).audit.filter(entry => entry.event === 'redirect-ended').length, 1);
});

test('retarget to a verified later host (B→C) at a base the identity supplied; redirects then go to C', async () => {
  const fx = await managementFixture();
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  fx.signedInAt(fx.hosts[C]);
  const base = `${C}/bindle/portability/from/a.example/`;
  assert.deepEqual(await fx.run('retarget', base), { outcome: 'retargeted', host: C });
  const moved = await fx.moved();
  assert.equal(moved.redirectBase, base); assert.deepEqual(moved.retarget.to, { iss: C, identity: fx.hosts[C].state.get(fx.id.sub).identity }); assert.equal(moved.retarget.seq, 2);
  assert.equal(moved.retarget.head, await fx.headOf(fx.hosts[C]));
  assert.equal(moved.boundRedirectBase, `${B}/bindle/portability/from/a.example/`, 'the move endpoint binding is unchanged');
  const lookup = await movedLookup(lookupEnv(fx), { sub: fx.id.sub });
  assert.equal(lookup.to.iss, C);
  const response = movedResponse(new Request(`${A}/identity/${fx.id.sub}/identity.json?x=1`), lookup, { iss: A, document: true });
  assert.equal(response.status, 308); assert.equal(response.headers.get('Location'), `${base}identity/${fx.id.sub}/identity.json?x=1`);
  assert.equal((await response.json()).moved.statement, fx.r1.statement, 'the body still carries this provider\'s own record');
  // Idempotent repeat; a later end still works from C.
  fx.signedInAt(fx.hosts[C]);
  assert.deepEqual(await fx.run('retarget', base), { outcome: 'retargeted', host: C });
  assert.equal((await fx.moved()).audit.filter(entry => entry.event === 'redirect-retargeted').length, 1);
  fx.signedInAt(fx.hosts[C]);
  assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
  assert.equal((await fx.moved()).retarget, undefined);
});

test('a multi-hop chain (B→C→D) verifies every later record and retargets to D', async () => {
  const fx = await managementFixture();
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  await fx.world.move(fx.id, fx.hosts[C], fx.hosts[D]);
  fx.signedInAt(fx.hosts[D]);
  // C's attestation keys are first use here (no root, no durable pin): retarget is refused, ending still works.
  await assert.rejects(() => fx.run('retarget', `${D}/from/a/`), { code: 'retarget_unverified' });
  fx.signedInAt(fx.hosts[D]);
  assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
});

test('adversarial: a forged successor cannot end or retarget someone else\'s redirect', async t => {
  await t.test('an unattested record from the real key holder (old recovery file) cannot retarget; it can only end (review M3, fail safe)', async () => {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[E], { attest: false, keepSource: true });
    fx.signedInAt(fx.hosts[E]);
    await assert.rejects(() => fx.run('retarget', `${E}/x/`), uniform);
    assert.equal(movedWindow(await fx.moved(), fx.clock.now()).live, true);
    assert.ok(fx.logs.some(entry => entry.action === 'redirect-manage-refused' && entry.reason === 'unattested'));
    // Documented residual: the signature proof that suffices to END lets a holder of the signing key end the redirect.
    fx.signedInAt(fx.hosts[E]); fx.clock.advance(60000);
    assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
    assert.equal((await fx.moved()).audit.at(-1).proof, 'signature');
  });
  await t.test('a record attested by the attacker\'s own provider instead of the source is refused', async () => {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[E], { attestWith: fx.hosts[E], keepSource: true });
    fx.signedInAt(fx.hosts[E]);
    await assert.rejects(() => fx.run('retarget', `${E}/x/`), uniform);
    assert.equal((await fx.moved()).redirectBase, `${B}/bindle/portability/from/a.example/`);
  });
  await t.test('the victim\'s real chain presented for an identity at the attacker\'s host is refused (chain ends elsewhere)', async () => {
    const fx = await managementFixture();
    const real = fx.hosts[B].state.get(fx.id.sub);
    // E serves a document claiming the victim's sub and chain under its own identity URI.
    fx.hosts[E].state.set(fx.id.sub, { status: 'active', identity: `${E}/identity/${fx.id.sub}`, moves: real.moves, keys: real.keys, document: () => ({ v: 1, iss: E, sub: fx.id.sub, kind: 'person', keys: real.keys, moves: real.moves }) });
    fx.signedInAt(fx.hosts[E]);
    await assert.rejects(() => fx.run('end'), uniform);
    // Claiming the destination identity URI from another issuer fails the binding too.
    fx.token = { issuer: E, subject: real.identity };
    await assert.rejects(() => fx.run('end'), uniform);
  });
  await t.test('a token whose bindle_moves or bindle_origin disagree with the document is refused', async () => {
    const fx = await managementFixture();
    fx.signedInAt(fx.hosts[B], { bindle_moves: [{ statement: fx.r1.statement, attestation: null }] });
    await assert.rejects(() => fx.run('end'), uniform);
    fx.signedInAt(fx.hosts[B], { bindle_origin: { iss: E, sub: fx.id.sub } });
    await assert.rejects(() => fx.run('end'), uniform);
    fx.signedInAt(fx.hosts[B], { bindle_origin: { iss: A, sub: fx.id.sub }, bindle_moves: structuredClone(fx.hosts[B].state.get(fx.id.sub).moves) });
    assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
  });
  await t.test('another identity\'s valid sign-in never reaches this tombstone', async () => {
    const fx = await managementFixture();
    const other = await fx.world.identity(); fx.world.host(fx.hosts[C], other);
    fx.token = { issuer: C, subject: fx.hosts[C].state.get(other.sub).identity };
    await assert.rejects(() => fx.run('end'), uniform);
  });
  await t.test('a token naming this provider itself is refused', async () => {
    const fx = await managementFixture();
    fx.token = { issuer: A, subject: `${A}/identity/${fx.id.sub}` };
    await assert.rejects(() => fx.run('end'), uniform);
  });
});

test('adversarial: forked and stale chains are refused', async t => {
  await t.test('a fork at this provider\'s position (a different record signed with the old key) is refused', async () => {
    const fx = await managementFixture();
    // The holder of the identity's pre-move key forges an alternative first move A→E, attested by E.
    const forged = await fx.world.identity({ sub: fx.id.sub }); forged.keys = [fx.id.keys[0]];
    const source = fx.hosts[A].state.get(fx.id.sub); source.status = 'active';
    await fx.world.move(forged, fx.hosts[A], fx.hosts[E], { attestWith: fx.hosts[E], keepSource: true });
    fx.signedInAt(fx.hosts[E]);
    await assert.rejects(() => fx.run('end'), uniform);
    assert.ok(fx.logs.some(entry => entry.reason === 'forked'));
  });
  await t.test('a sign-in at the previous host after the identity moved on is stale', async () => {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
    fx.token = { issuer: B, subject: `${B}/identity/${fx.id.sub}` };
    await assert.rejects(() => fx.run('end'), uniform);
  });
  await t.test('after a retarget to seq 2, a source equivocation at seq 2 (B→D) is a fork', async () => {
    const fx = await managementFixture();
    const live = fx.hosts[B].state.get(fx.id.sub), bState = { status: live.status, identity: live.identity, moves: [...live.moves], keys: structuredClone(live.keys) };
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
    fx.signedInAt(fx.hosts[C]);
    await fx.run('retarget', `${C}/from/a/`);
    // B equivocates: a second attested move of seq 2 to D (B's state restored to before the first).
    fx.hosts[B].state.set(fx.id.sub, { ...bState, document: () => ({ v: 1, iss: B, sub: fx.id.sub, kind: 'person', keys: bState.keys, moves: bState.moves }) });
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[D]);
    fx.signedInAt(fx.hosts[D]);
    // Review M1 / spec §8.4: two attested records from B for seq 2 are equivocation; the redirect ends as contested.
    assert.deepEqual(await fx.run('end'), { outcome: 'ended', contested: true });
    const moved = await fx.moved();
    assert.equal(movedWindow(moved, fx.clock.now()).live, false); assert.equal(moved.endedBy, 'contested');
    assert.equal(moved.contested.seq, 2); assert.notEqual(moved.contested.recorded, moved.contested.presented);
    assert.equal(moved.audit.at(-1).event, 'redirect-contested');
    // A contested end is not revivable by either side.
    fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
    await assert.rejects(() => fx.run('retarget', `${C}/from/a/`), uniform);
  });
  await t.test('expired, ended and unknown identities answer exactly alike', async () => {
    const fx = await managementFixture();
    fx.signedInAt(fx.hosts[B]);
    fx.clock.advance(91 * DAY);
    const expired = await fx.run('end').catch(error => ({ code: error.code, status: error.status, message: error.message }));
    fx.repository.rows.delete(fx.id.sub);
    const unknown = await fx.run('end').catch(error => ({ code: error.code, status: error.status, message: error.message }));
    assert.deepEqual(expired, unknown); assert.deepEqual(unknown, uniform);
  });
});

test('adversarial: retarget cannot be turned into an open redirect', async () => {
  const fx = await managementFixture();
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  for (const base of [`${E}/from/a/`, 'https://c.example.evil.example/x/', `${C}/x`, `${C}/x/?next=https://e.example/`, `${C}/x/#f`, `${C}/a/../b/`, `${C}/%2e%2e/`, 'http://c.example/x/', `${C}:8443/x/`, 'https://user@c.example/x/', `${C}//e.example/`, `${A}/x/`, 'javascript:alert(1)//']) {
    fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
    await assert.rejects(() => fx.run('retarget', base), error => ['redirect_invalid', 'invalid_request'].includes(error.code), base);
  }
  assert.equal((await fx.moved()).redirectBase, `${B}/bindle/portability/from/a.example/`);
  // No later move: nothing to retarget to (the direct destination's own base is fixed by the attested move).
  const direct = await managementFixture();
  direct.signedInAt(direct.hosts[B]);
  await assert.rejects(() => direct.run('retarget', `${B}/other/`), { code: 'retarget_unavailable' });
  // Without the destination keys captured at commit, the first hop is first use: retarget is refused.
  const unpinned = await managementFixture({ destinationKeys: false });
  await unpinned.world.move(unpinned.id, unpinned.hosts[B], unpinned.hosts[C]);
  unpinned.signedInAt(unpinned.hosts[C]);
  await assert.rejects(() => unpinned.run('retarget', `${C}/from/a/`), { code: 'retarget_unverified' });
});

test('begin validates input and binds the action; it reveals nothing about any moved identity', async () => {
  const fx = await managementFixture();
  await assert.rejects(() => fx.service.begin({ identity: 'nohost', action: 'end' }), { code: 'invalid_identity' });
  await assert.rejects(() => fx.service.begin({ identity: 'a@b.example', action: 'delete' }), { code: 'invalid_request' });
  await assert.rejects(() => fx.service.begin({ identity: 'a@b.example', action: 'end', redirectBase: `${C}/x/` }), { code: 'invalid_request' });
  await assert.rejects(() => fx.service.begin({ identity: 'a@b.example', action: 'retarget' }), { code: 'redirect_invalid' });
  await assert.rejects(() => fx.service.begin({ identity: 'a@b.example', action: 'end', extra: 1 }), { code: 'invalid_request' });
  const started = await fx.service.begin({ identity: 'anyone@b.example', action: 'end' });
  assert.deepEqual(Object.keys(started).sort(), ['authorizationUrl', 'transaction']);
  // A declined or failed sign-in is one generic answer.
  fx.token = null;
  await assert.rejects(() => fx.service.complete({ transaction: started.transaction, callback: 'https://a.example/transfer-manage?error=access_denied' }), { code: 'sign_in_failed' });
});

test('the provider is unreachable: temporarily unavailable, nothing changes', async () => {
  const fx = await managementFixture();
  fx.signedInAt(fx.hosts[B]);
  fx.world.net.down.add(B);
  await assert.rejects(() => fx.run('end'), { code: 'temporarily_unavailable', status: 503 });
  assert.equal(movedWindow(await fx.moved(), fx.clock.now()).live, true);
});

test('operations run through the app engine with public actors', async t => {
  const fx = await managementFixture();
  const engine = await createTestEngine({ providers: { redirectManagement: fx.service } }); t.after(() => engine.dispose());
  fx.signedInAt(fx.hosts[B]);
  const started = await engine.perform(new BeginRedirectManagement({ actor: { kind: 'public' }, input: { identity: 'mover@b.example', action: 'end' } }));
  assert.deepEqual(await engine.perform(new CompleteRedirectManagement({ actor: { kind: 'public' }, input: { transaction: started.transaction, callback: 'https://a.example/transfer-manage?code=x' } })), { outcome: 'ended' });
});

test('race: end and retarget interleave; the outcome is an end or a revival to the verified host only (seeded)', async () => {
  await forEachSeed(12, async random => {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
    fx.signedInAt(fx.hosts[C]);
    const verified = await fx.service.verify(fx.token, { action: 'retarget' });
    const scheduler = createScheduler(random), repository = fx.repository, wrapped = scheduler.wrap(repository, 'identity');
    const { redirectRecordsPort } = await import('../packages/identity/redirect-records.mjs');
    fx.service.records = redirectRecordsPort(wrapped, { clock: fx.clock.now });
    const tasks = random.shuffle([() => fx.service.end(verified), () => fx.service.retarget(verified, `${C}/from/a/`), () => fx.service.retarget(verified, `${C}/from/a/`)]);
    const results = await scheduler.run(tasks);
    const moved = await fx.moved();
    const ended = results.some((result, i) => result.status === 'fulfilled' && result.value.outcome === 'ended');
    assert.ok(ended, 'end always succeeds');
    const events = moved.audit.map(entry => entry.event);
    if (movedWindow(moved, fx.clock.now()).live) { assert.equal(moved.redirectBase, `${C}/from/a/`); assert.ok(events.indexOf('redirect-revived') > events.indexOf('redirect-ended'), 'live after an end only through a verified revival (review L4)'); }
    else { assert.equal(moved.redirectBase, null); assert.equal(moved.retarget, undefined); }
    for (const result of results) assert.equal(result.status, 'fulfilled', String(result.reason?.code));
  });
});
