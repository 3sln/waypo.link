// Seeded chaos for the active-account recovery reissue (docs/spec/recovery-identity.md "Active-account reissue"):
// two sessions reissuing, an ordinary signing-key rotation, a recovery with the current file, a transfer-out commit and
// a deletion request, interleaved at every identity-repository and account-object call. The account-side events are
// logged from inside the single-writer gate, so the log is their linearization order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reissueFixture, TRANSFER_KEY, REQUEST_KEY } from './helpers/recovery-reissue.mjs';
import { forEachSeed, createScheduler } from './helpers/chaos.mjs';
import { transferIdentityPort } from '../packages/identity/transfer-out.mjs';

const ALLOWED = new Set(['conflict', 'unauthorized', 'recovery_reissue_expired', 'recovery_changed', 'deletion_scheduled', 'identity_moved', 'key_conflict', 'reauthentication_required', 'account_not_active']);

test('seeded chaos: reissue vs rotation vs recovery vs transfer commit vs deletion keeps one current file, never commits over a move or a deletion, and never commits an unrestorable file', async t => {
  await forEachSeed(16, async random => {
    let scheduler = null; const wrap = (target, label) => new Proxy(target, { get: (object, name) => { const value = Reflect.get(object, name); if (typeof value !== 'function' || !scheduler) return typeof value === 'function' ? value.bind(object) : value; return scheduler.wrap(object, label)[name]; } });
    const f = await reissueFixture(t, { wrap }), { c, id } = f;
    await f.age();
    const transfer = random.chance(0.6), order = [], issued = [], confirmed = [];
    if (transfer) await f.seedTransfer({ state: 'pending' });
    // Log the account-side outcomes from inside the gate (instance methods shadow the slice's).
    const prepare = c.recoveryReissuePrepare, commit = c.recoveryReissueCommit;
    c.recoveryReissuePrepare = async function (...args) { const result = await prepare.apply(this, args); order.push(`prepare:${result.keychain.signing.kid}`); return result; };
    c.recoveryReissueCommit = async function (...args) { const result = await commit.apply(this, args); order.push(`commit:${args[1].kids.signing}`); return result; };
    const second = await f.secondSession();
    // A client retries a whole step on `conflict` (another write won the identity revision), as the console does.
    const retry = async step => { for (let attempt = 0; ; attempt++) try { return await step(); } catch (error) { if (error?.code !== 'conflict' || attempt >= 3) throw error; } };
    const reissue = context => async () => {
      await retry(() => f.stepUp('password', context));
      const staged = f.parse(await retry(() => f.begin(undefined, context))); issued.push(staged);
      await retry(() => f.confirm(staged, {}, context)); confirmed.push(staged);
    };
    const inGate = work => c.gate.run(work);
    const work = random.shuffle([
      reissue(f.ctx), reissue(second),
      () => random.chance(0.5) ? inGate(async () => { const kid = (await c.signingKey(id)).kid; await c.rotateIdentityKey(id, { purpose: 'signing', expectedKid: kid }); order.push('rotation'); }) : null,
      () => random.chance(0.4) ? f.recover(f.file) : null,
      () => transfer && random.chance(0.6) ? inGate(async () => { const record = await c.metadata.get(TRANSFER_KEY); if (record?.state === 'pending') { await c.metadata.put(TRANSFER_KEY, { ...record, state: 'committed', revision: record.revision + 1 }); order.push('transfer-commit'); } }) : null,
      () => random.chance(0.4) ? inGate(async () => { await c.metadata.put(REQUEST_KEY, { state: 'scheduled' }); order.push('deletion'); }) : null,
    ]);
    scheduler = createScheduler(random);
    const results = await scheduler.run(work); scheduler = null;
    for (const result of results) if (result.status === 'rejected') assert.ok(ALLOWED.has(result.reason?.code), `unexpected ${result.reason?.code}: ${result.reason?.message}\n${order.join(' ')}`);
    const record = await f.identity(), port = transferIdentityPort(f.repository, { clock: f.now });
    // One current file at most, and it is the last committed one (or the original when none committed).
    const files = [f.file, ...issued], current = [];
    for (const file of files) if (await port.verifyRecovery(id, file.recoveryToken)) current.push(file);
    assert.ok(current.length <= 1, 'at most one file is current');
    if (record.status === 'active') assert.equal(current[0], confirmed.at(-1) ?? f.file, 'the last committed file is current');
    // Commits are linearized after no move commit and no deletion request.
    for (const [index, event] of order.entries()) if (event.startsWith('commit:')) {
      assert.equal(order.slice(0, index).includes('transfer-commit'), false, `a reissue committed over a committed move: ${order.join(' ')}`);
      assert.equal(order.slice(0, index).includes('deletion'), false, `a reissue committed after a deletion request: ${order.join(' ')}`);
      const kid = event.slice(7), prepared = order.indexOf(`prepare:${kid}`);
      assert.ok(prepared >= 0 && prepared < index); assert.equal(order.slice(prepared, index).includes('rotation'), false, `a staged file was committed after a rotation cleared its binding: ${order.join(' ')}`);
    }
    if (confirmed.length && transfer) assert.notEqual((await c.metadata.get(TRANSFER_KEY)).state, 'committed', 'a committed reissue cancelled the pending move first');
    // Every file that was current once and no longer is holds a retired key (P15). A recovering account's original
    // file is its resume credential instead, which keeps its key until the replacement download rotates (PORT-10).
    if (record.status === 'active') {
    const signing = (await c.identityKeyHistory(id, { purpose: 'signing' })).find(entry => entry.current)?.kid;
    for (const file of [f.file, ...confirmed.slice(0, -1)]) if (!current.includes(file)) assert.notEqual(file.backup.keychain.signing.kid, signing, 'a superseded file never holds the current key');
    }
    // The current file restores unless an ordinary rotation (which retires every older file by design) followed it.
    if (current.length && record.status === 'active') {
      const [file] = current, kid = file.backup.keychain.signing.kid, prepared = order.indexOf(`prepare:${kid}`);
      if (!order.slice(Math.max(prepared, 0)).includes('rotation')) assert.equal(await c.recoveryKeysMatch(id, file.backup.keychain), true, `the current file restores: ${order.join(' ')}`);
    }
  });
});
