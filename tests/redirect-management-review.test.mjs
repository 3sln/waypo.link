// Regressions for the independent review of redirect management (2026-10-23): M1 equivocation lockout, M2 refunds
// after an early end, M3 ending after an intermediate host lapsed (and the 30-day target probe), L1 Node egress
// content types, L2 sign-in egress budgets, L3 reminder sends, L4 a former host's end and the owner's revival, and the
// purpose-bound transaction sealing. Each test fails when its fix is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { managementFixture, memoryRepository, A, B, C, E, DAY } from './helpers/redirect-management.mjs';
import { fakePolar, extensionService, REDIRECT_ID } from './helpers/redirect-billing.mjs';
import { transferIdentityPort } from '../packages/identity/transfer-out.mjs';
import { lifecycleIdentityPort, movedWindow } from '../packages/identity/lifecycle-tombstone.mjs';
import { redirectRecordsPort, createRedirectReminders, REDIRECT_TIMING } from '../packages/identity/redirect-records.mjs';
import { createNodePortabilityFetch } from '../packages/identity/node-portability-fetch.mjs';
import { bindleRedirectSignin, budgetedEgress, REDIRECT_CLIENT_PATH, MANAGE_PATH } from '../packages/runtime/redirect-management.mjs';
import { encryptSecret } from '../packages/runtime/secrets.mjs';
import { createMockProvider } from '../packages/sdk/src/testing.mjs';
import { fakeClock } from './helpers/chaos.mjs';

const SECRET = Buffer.alloc(32, 7).toString('base64');
const uniform = { code: 'not_found', status: 404 };
/** A→B→C (the owner's real chain), then B turns hostile and attests a second seq-2 move to the attacker's host E. */
async function hostileFork() {
  const fx = await managementFixture();
  const live = fx.hosts[B].state.get(fx.id.sub), bState = { status: live.status, identity: live.identity, moves: [...live.moves], keys: structuredClone(live.keys) };
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  fx.hosts[B].state.set(fx.id.sub, { ...bState, document: () => ({ v: 1, iss: B, sub: fx.id.sub, kind: 'person', keys: bState.keys, moves: bState.moves }) });
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[E]);
  return fx;
}

test('M1: a hostile former host that forks first and retargets cannot lock the owner out; the owner\'s attested chain ends it as contested', async () => {
  for (const action of ['retarget', 'end']) {
    const fx = await hostileFork();
    fx.signedInAt(fx.hosts[E]);
    assert.equal((await fx.run('retarget', `${E}/phish/`)).outcome, 'retargeted');
    fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
    assert.deepEqual(await fx.run(action, action === 'retarget' ? `${C}/from/a/` : undefined), { outcome: 'ended', contested: true });
    const moved = await fx.moved();
    assert.equal(movedWindow(moved, fx.clock.now()).live, false, 'old links no longer go to the attacker host');
    assert.equal(moved.endedBy, 'contested'); assert.equal(moved.contested.seq, 2);
    assert.match(moved.contested.recorded, /^sha256-/); assert.match(moved.contested.presented, /^sha256-/);
    assert.doesNotMatch(JSON.stringify(moved.audit), /@|:\/\//);
    // Nobody revives a contested end: not the attacker, not the owner (support decides; spec §8.4).
    for (const host of [E, C]) { fx.signedInAt(fx.hosts[host]); fx.clock.advance(60000); await assert.rejects(() => fx.run('retarget', `${host}/again/`), uniform); }
  }
});

test('M2/R2-5: a settled extension is never refunded after the record ends, nor after the purge; every other order is', async () => {
  const fx = await managementFixture();
  fx.repository.rows.get(fx.id.sub).moved.redirectId = REDIRECT_ID;
  fx.clock.advance(40 * DAY);
  const polar = fakePolar({ clock: fx.clock, owner: fx.id.sub }), ext = extensionService({ repository: fx.repository, clock: fx.clock, polar, owner: fx.id.sub, due: { put: async () => {} } });
  polar.add('order_1'); fx.clock.advance(1000);
  await ext.applyWebhook(polar.event('order_1'));
  fx.signedInAt(fx.hosts[B]);
  assert.equal((await fx.run('end')).outcome, 'ended');
  const port = transferIdentityPort(fx.repository, { clock: fx.clock.now });
  fx.clock.advance(8 * DAY);
  assert.deepEqual(await port.endMoved(fx.id.sub), { ok: true, ended: false, nextAt: (await fx.moved()).settlement.until }, 'the marker keeps the row');
  const stub = await fx.moved();
  assert.equal(stub.ended, true); assert.equal(typeof stub.settlement.settledOrder, 'string'); assert.equal(stub.settlement.until - stub.settlement.endedAt, 400 * DAY);
  assert.doesNotMatch(JSON.stringify(stub), /order_1|b\.example/);
  for (const type of ['order.updated', 'order.paid', 'order.refunded']) assert.equal((await ext.applyWebhook(polar.event('order_1', type))).ignored, true);
  assert.deepEqual(polar.refunds, []);
  // R2-5: any order that is not the settled one bought nothing and is refunded in full, whenever it was paid.
  polar.add('order_early', { created_at: new Date(stub.settlement.endedAt - 1000).toISOString() });
  assert.equal((await ext.applyWebhook(polar.event('order_early'))).refunded, true);
  polar.add('order_late');
  assert.equal((await ext.applyWebhook(polar.event('order_late'))).refunded, true);
  assert.deepEqual(polar.refunds.map(r => r.order), ['order_early', 'order_late']);
  // After 400 days the marker goes, and nothing else stays.
  fx.clock.advance(401 * DAY);
  assert.deepEqual(await port.endMoved(fx.id.sub), { ok: true, ended: true });
  assert.equal((await fx.moved()).settlement, undefined);
});

test('M2: the purged tombstone keeps the marker when the record was no longer kept', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 23)), repository = memoryRepository(), now = clock.now();
  repository.rows.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', handle: 'h', assignmentId: 'x', status: 'moved', revision: 1, credentials: [], moved: { v: 1, redirectBase: null, redirectUntil: now - 10 * DAY, endedAt: now - 10 * DAY, endedBy: 'owner', settledOrder: 'S'.repeat(43), movedUntil: now - DAY, attestation: 'a', statement: 's', committedAt: now - 60 * DAY } });
  assert.equal(await lifecycleIdentityPort(repository, { clock: clock.now }).tombstone('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { reason: 'moved' }), true);
  const row = await repository.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(row.status, 'deleted'); assert.deepEqual(row.movedSettlement, { endedAt: now - 10 * DAY, until: now - 10 * DAY + 400 * DAY, settledOrder: 'S'.repeat(43) });
});

test('M3: after an intermediate host disappears or lapses, the owner can still end (signature proof); a retarget still needs full proof', async () => {
  for (const failure of ['down', 'lapse']) {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
    if (failure === 'down') fx.world.net.down.add(B); else await fx.hosts[B].lapse();
    fx.signedInAt(fx.hosts[C]);
    await assert.rejects(() => fx.run('retarget', `${C}/from/a/`), error => [404, 503].includes(error.status), failure);
    fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
    assert.deepEqual(await fx.run('end'), { outcome: 'ended' }, failure);
    assert.equal((await fx.moved()).audit.at(-1).proof, 'signature');
  }
  // A forged later statement (not under a key linked from our signer) still cannot end it.
  const fx = await managementFixture();
  const stranger = await fx.world.identity({ sub: fx.id.sub });
  await fx.world.move(stranger, fx.hosts[B], fx.hosts[E], { keepSource: true });
  fx.signedInAt(fx.hosts[E]);
  await assert.rejects(() => fx.run('end'), uniform);
});

test('design §6.4 / R2-4: three or more 404s spread over 30 days end the redirect; live or invalid answers and gaps reset it', async () => {
  const fx = await managementFixture(), sub = fx.id.sub;
  let status = 'gone'; const document = async () => ({ status });
  const records = redirectRecordsPort(fx.repository, { clock: fx.clock.now });
  const daily = async days => { for (let i = 0; i < days; i++) { await records.probe(sub, { document }); fx.clock.advance(DAY); } };
  await daily(20); status = 'ok'; await daily(1);
  assert.equal((await fx.moved()).probe, undefined, 'a live answer resets the clock');
  status = 'gone'; await daily(5); status = 'invalid'; await daily(1);
  assert.equal((await fx.moved()).probe, undefined, 'an invalid answer resets the clock');
  // Two answers 30 days apart are not enough (count and gap rules).
  status = 'gone'; await records.probe(sub, { document }); fx.clock.advance(30 * DAY); await records.probe(sub, { document });
  assert.equal(movedWindow(await fx.moved(), fx.clock.now()).live, true); assert.equal((await fx.moved()).probe.count, 1, 'a gap restarts the count');
  await daily(30); const out = await records.probe(sub, { document });
  assert.deepEqual(out, { ok: true, done: true, ended: true });
  assert.equal((await fx.moved()).endedBy, 'target-gone');
  // Unreachable is never "gone".
  const other = await managementFixture(); const r2 = redirectRecordsPort(other.repository, { clock: other.clock.now });
  for (let i = 0; i < 40; i++) { await r2.probe(other.id.sub, { document: async () => { throw new Error('down'); } }); other.clock.advance(DAY); }
  assert.equal((await other.moved()).probe, undefined); assert.equal((await other.moved()).endedBy, undefined);
  // A retarget deletes the probe (a new target starts a new clock).
  const third = await managementFixture(); await third.world.move(third.id, third.hosts[B], third.hosts[C]);
  const r3 = redirectRecordsPort(third.repository, { clock: third.clock.now }); await r3.probe(third.id.sub, { document: async () => ({ status: 'gone' }) });
  assert.equal((await third.moved()).probe.count, 1);
  third.signedInAt(third.hosts[C]); await third.run('retarget', `${C}/from/a/`);
  assert.equal((await third.moved()).probe, undefined);
  const reminders = createRedirectReminders({ records: r2, origin: A, client: { document: async () => ({ status: 'ok' }) } });
  assert.equal((await reminders.probe(other.id.sub)).ok, true);
});

test('L1: the Node egress keeps an allowlisted form Content-Type; a sign-in runs over it end to end', async () => {
  const seen = [];
  const provider = createMockProvider({ issuer: 'https://provider.example.com', accounts: [{ handle: 'mover', subject: 'https://provider.example.com/identity/x' }], clients: [{ clientId: 'https://source.example.com' + REDIRECT_CLIENT_PATH, redirectUris: ['https://source.example.com' + MANAGE_PATH] }], declaration: 'standard', clientMetadata: true });
  const request = (options, onResponse) => {
    const req = new EventEmitter(), chunks = []; req.destroy = () => {}; req.write = chunk => chunks.push(chunk);
    req.end = async body => {
      seen.push(options.headers);
      const response = await provider.fetch(`https://${options.hostname}${options.path}`, { method: options.method, headers: { 'Content-Type': options.headers['Content-Type'] ?? 'application/json' }, ...options.method === 'POST' ? { body: Buffer.from(body ?? Buffer.concat(chunks)).toString() } : {} });
      const text = Buffer.from(await response.arrayBuffer()), res = new EventEmitter(); res.statusCode = response.status; res.headers = Object.fromEntries(response.headers); res.destroy = () => {};
      onResponse(res); res.emit('data', text); res.emit('end');
    };
    return req;
  };
  const fetch = createNodePortabilityFetch({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], request });
  const signin = bindleRedirectSignin({ origin: 'https://source.example.com', secret: SECRET, fetcher: fetch });
  const started = await signin.begin({ identity: 'mover@provider.example.com', intent: { action: 'end' } });
  const { token, intent } = await signin.complete({ transaction: started.transaction, callback: provider.authorize(started.authorizationUrl) });
  assert.equal(token.subject, 'https://provider.example.com/identity/x'); assert.deepEqual(intent, { action: 'end' });
  const tokenCall = seen.find(headers => headers['Content-Type'] === 'application/x-www-form-urlencoded');
  assert.ok(tokenCall, 'the form-encoded token exchange is not relabelled as JSON');
  assert.ok(seen.some(headers => headers['Content-Type'] === 'application/json'), 'JSON stays JSON');
});

test('L2: sign-in egress spends the portability budgets before any request and has a deadline', async () => {
  const calls = [], budget = { left: 2, consume: async () => budget.left-- > 0 };
  const egress = budgetedEgress(async (url, init) => { calls.push({ url, signal: init.signal }); return new Response('{}'); }, budget);
  await egress('https://provider.example/one');
  assert.ok(calls[0].signal instanceof AbortSignal, 'a deadline is attached');
  await assert.rejects(() => egress('https://provider.example/two'), { code: 'temporarily_unavailable' });
  assert.equal(calls.length, 1, 'refused before egress');
  const fx = await managementFixture(), blocked = bindleRedirectSignin({ origin: A, secret: SECRET, fetcher: async () => { throw new Error('must not dial'); }, limiter: { consume: async () => false } });
  await assert.rejects(() => blocked.begin({ identity: 'mover@b.example', intent: { action: 'end' } }));
  assert.ok(fx);
});

test('L3: a reminder that did not throw counts as sent (one email); a crash after the claim never sends a second', async () => {
  const fx = await managementFixture(), sub = fx.id.sub; fx.clock.advance(61 * DAY);
  const records = redirectRecordsPort(fx.repository, { clock: fx.clock.now }); let sends = 0;
  for (let i = 0; i < 4; i++) { await records.remind(sub, { send: async () => { sends++; return undefined; } }); fx.clock.advance(DAY); }
  assert.equal(sends, 1); assert.equal((await fx.moved()).reminder.state, 'sent');
  // A crash between the claim and the result: the attempt stays 'sending' and is never retried.
  const crash = await managementFixture(); crash.clock.advance(61 * DAY);
  const row = crash.repository.rows.get(crash.id.sub); row.moved.reminder = { for: row.moved.redirectUntil, attempts: 1, attemptedAt: crash.clock.now(), accepted: false, state: 'sending' };
  crash.clock.advance(2 * DAY); let again = 0;
  await redirectRecordsPort(crash.repository, { clock: crash.clock.now }).remind(crash.id.sub, { send: async () => { again++; } });
  assert.equal(again, 0);
});

test('L4: a former host may end the redirect before any retarget; the verified current owner revives it within the settlement window, not after', async () => {
  for (const late of [false, true]) {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
    // B, a former host that still answers for the identity, serves a document that drops B→C and ends the redirect.
    const live = fx.hosts[B].state.get(fx.id.sub), moves = [live.moves[0]], keys = structuredClone(fx.hosts[C].state.get(fx.id.sub).keys.slice(0, 2)).map((key, i) => i === 1 ? { ...key, state: 'active' } : key);
    fx.hosts[B].state.set(fx.id.sub, { status: 'active', identity: live.identity, moves, keys, document: () => ({ v: 1, iss: B, sub: fx.id.sub, kind: 'person', keys, moves }) });
    fx.token = { issuer: B, subject: live.identity };
    assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
    // The real owner at C (full proof) revives it, pointing at C; B restored to its honest state for the let-go check.
    fx.hosts[B].state.set(fx.id.sub, live);
    fx.clock.advance(late ? REDIRECT_TIMING.settlement + 1 : DAY);
    fx.signedInAt(fx.hosts[C]);
    if (late) { await assert.rejects(() => fx.run('retarget', `${C}/from/a/`), uniform); continue; }
    assert.deepEqual(await fx.run('retarget', `${C}/from/a/`), { outcome: 'retargeted', host: C, revived: true });
    const moved = await fx.moved();
    assert.equal(movedWindow(moved, fx.clock.now()).live, true); assert.equal(moved.redirectBase, `${C}/from/a/`); assert.equal(moved.reminderEmail, undefined, 'the deleted reminder email stays deleted');
    assert.deepEqual(moved.audit.slice(-2).map(entry => entry.event), ['redirect-ended', 'redirect-revived']);
  }
});

test('info: the transaction is sealed with a purpose-bound key; a credential record sealed with the shared key is not accepted', async () => {
  const signin = bindleRedirectSignin({ origin: A, secret: SECRET, fetcher: async () => { throw new Error('no egress'); } });
  const forged = await encryptSecret({ v: 1, purpose: 'redirect-management', items: {}, state: 's', issuer: B, intent: { action: 'end' }, exp: Date.now() + 60000 }, SECRET);
  const transaction = Buffer.from(JSON.stringify(forged)).toString('base64url');
  await assert.rejects(() => signin.complete({ transaction, callback: `${A}/transfer-manage?state=s&iss=${encodeURIComponent(B)}&code=c` }));
});

// ---- re-review round 2 ----------------------------------------------------------------------------------------
const snapshotB = fx => { const live = fx.hosts[B].state.get(fx.id.sub); return { status: live.status, identity: live.identity, moves: [...live.moves], keys: structuredClone(live.keys) }; };
const restoreB = (fx, s) => fx.hosts[B].state.set(fx.id.sub, { ...s, document: () => ({ v: 1, iss: B, sub: fx.id.sub, kind: 'person', keys: s.keys, moves: s.moves }) });

test('R2-1: after a retarget, a former host serving its old state (no new signature) cannot end the redirect', async () => {
  const fx = await managementFixture(); const s = snapshotB(fx);
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  fx.signedInAt(fx.hosts[C]);
  assert.equal((await fx.run('retarget', `${C}/from/a/`)).outcome, 'retargeted');
  assert.ok((await fx.moved()).retarget.keys[B]?.length, 'R2-3: the retarget stores the rooted attestation keys it verified');
  restoreB(fx, s); fx.signedInAt(fx.hosts[B]); fx.clock.advance(60000);
  await assert.rejects(() => fx.run('end'), uniform);
  assert.equal(fx.logs.at(-1).reason, 'stale');
  const moved = await fx.moved();
  assert.equal(movedWindow(moved, fx.clock.now()).live, true); assert.equal(moved.redirectBase, `${C}/from/a/`);
  // The owner at C still ends it (its chain extends the recorded one).
  fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
  assert.deepEqual(await fx.run('end'), { outcome: 'ended' });
});

test('R2-2: a hostile former host cannot revive the owner\'s end to itself; its attested fork marks the end contested', async () => {
  const fx = await managementFixture(); const s = snapshotB(fx);
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  fx.signedInAt(fx.hosts[C]);
  assert.equal((await fx.run('end')).outcome, 'ended');
  assert.equal((await fx.moved()).endedProof.seq, 2); assert.equal((await fx.moved()).endedProof.digests.length, 1);
  assert.doesNotMatch(JSON.stringify((await fx.moved()).endedProof), /:\/\//, 'address-free');
  restoreB(fx, s); await fx.world.move(fx.id, fx.hosts[B], fx.hosts[E]);
  fx.signedInAt(fx.hosts[E]); fx.clock.advance(3600000);
  assert.deepEqual(await fx.run('retarget', `${E}/phish/`), { outcome: 'ended', contested: true });
  const moved = await fx.moved();
  assert.equal(movedWindow(moved, fx.clock.now()).live, false); assert.equal(moved.redirectBase, null); assert.equal(moved.contested.seq, 2);
  fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
  await assert.rejects(() => fx.run('retarget', `${C}/from/a/`), uniform, 'a contested end is not revived');
});

test('R2-2: a revival chain must be at least as long as the ender\'s; an unattested divergence is refused', async () => {
  const fx = await managementFixture();
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  const cState = fx.hosts[C].state.get(fx.id.sub), cSnap = { status: cState.status, identity: cState.identity, moves: [...cState.moves], keys: structuredClone(cState.keys) };
  await fx.world.move(fx.id, fx.hosts[C], fx.hosts[fx.world.providers.get('https://d.example').origin]);
  fx.signedInAt(fx.hosts['https://d.example']);
  assert.equal((await fx.run('end')).outcome, 'ended');
  // C, a former host, serves its old state and tries to revive to itself: shorter than what the ender proved.
  fx.hosts[C].state.set(fx.id.sub, { ...cSnap, document: () => ({ v: 1, iss: C, sub: fx.id.sub, kind: 'person', keys: cSnap.keys, moves: cSnap.moves }) });
  fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
  await assert.rejects(() => fx.run('retarget', `${C}/from/a/`), uniform);
  assert.equal(fx.logs.at(-1).reason, 'stale');
  // A divergent but unattested record is refused (neither revived nor contested).
  const g = await managementFixture(); const s = snapshotB(g);
  await g.world.move(g.id, g.hosts[B], g.hosts[C]); g.signedInAt(g.hosts[C]); await g.run('end');
  restoreB(g, s); await g.world.move(g.id, g.hosts[B], g.hosts[E], { attest: false });
  g.signedInAt(g.hosts[E]); g.clock.advance(60000);
  await assert.rejects(() => g.run('retarget', `${E}/x/`), uniform);
  assert.equal((await g.moved()).contested, undefined); assert.equal(g.logs.at(-1).reason, 'forked');
});

test('R2-3: equivocation evidence counts only under rooted or pinned keys, never first-use ones', async () => {
  const fx = await hostileFork();
  fx.signedInAt(fx.hosts[C]);
  // The owner retargets to C; then the record loses its pins (no destination keys, no stored retarget keys).
  const live = fx.hosts[B].state.get(fx.id.sub);
  assert.ok(live);
  fx.signedInAt(fx.hosts[E]);
  assert.equal((await fx.run('retarget', `${E}/phish/`)).outcome, 'retargeted');
  const row = fx.repository.rows.get(fx.id.sub); delete row.moved.destinationKeys; delete row.moved.retarget.keys;
  fx.signedInAt(fx.hosts[C]); fx.clock.advance(60000);
  await assert.rejects(() => fx.run('end'), uniform, 'first-use attestation is not evidence: refused, not contested');
  assert.equal((await fx.moved()).contested, undefined); assert.equal(fx.logs.at(-1).reason, 'forked');
});

test('R2-4: a revival deletes the probe and re-arms the probe row', async () => {
  const fx = await managementFixture();
  await fx.world.move(fx.id, fx.hosts[B], fx.hosts[C]);
  const records = redirectRecordsPort(fx.repository, { clock: fx.clock.now });
  fx.signedInAt(fx.hosts[C]); await fx.run('end');
  fx.repository.rows.get(fx.id.sub).moved.probe = { goneSince: fx.clock.now(), count: 2, lastAt: fx.clock.now() };
  fx.clock.advance(DAY); fx.due.length = 0; fx.signedInAt(fx.hosts[C]);
  assert.equal((await fx.run('retarget', `${C}/from/a/`)).revived, true);
  assert.equal((await fx.moved()).probe, undefined);
  assert.deepEqual(fx.due.map(row => row.kind).sort(), ['moved-end', 'moved-probe']);
  assert.ok(records);
});
