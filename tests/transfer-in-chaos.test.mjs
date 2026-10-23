// PORT-4 seeded chaos (identity-portability design §10.3): the real PORT-2 source and the PORT-4 destination under random
// interleavings of duplicate and concurrent begins and steps, lost responses, source outages, disputes, holds and
// cancellations at the source, kill-switch flips, clock jumps and crashes inside activation stages (identity commit,
// rotation, attestation verification). Rerun a failing seed with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forEachSeed, injectFaults, concurrently } from './helpers/chaos.mjs';
import { portabilityPair, OWNER, HOUR, DAY, MINUTE } from './helpers/transfer-in.mjs';
import { TRANSFER_IN_ROTATION } from '../packages/identity/keys.mjs';
import { verifyChain } from '../packages/identity/succession.mjs';

const outcomes = { active: 0, ended: 0, faults: 0 };
const STEPS = [MINUTE, 10 * MINUTE, HOUR, 6 * HOUR, 25 * HOUR, 3 * DAY];
const swallow = async work => { try { return await work(); } catch (error) { if (typeof error?.code === 'string') return undefined; throw error; } };

async function schedule(random) {
  const hooks = [], t = { after: fn => hooks.push(fn) };
  try {
    const p = await portabilityPair(t, { seed: random.seed }), { dest, source } = p;
    const original = { identity: dest.ports.identity, keys: dest.ports.keys, pins: dest.ports.pins };
    await dest.reserve(p.pkg);
    let crashed = 0;
    const ops = [
      [5, () => swallow(() => dest.begin(p.pkg))],
      [8, () => swallow(() => dest.step())],
      [3, () => concurrently([() => swallow(() => dest.step()), () => swallow(() => dest.step()), () => swallow(() => dest.begin(p.pkg))])],
      [6, () => { p.clock.advance(random.pick(STEPS)); }],
      [4, () => swallow(() => source.step())],
      [1, () => swallow(async () => { const token = source.tokenFor(random.pick(['email', 'push'])); if (token) await source.dispute({ token, choice: random.pick(['hold', 'abort']) }); })],
      [1, () => swallow(() => source.cancel())],
      [1, () => swallow(() => dest.cancel())],
      [3, () => { p.served.moveDown = random.chance(0.4); }],
      [2, () => { if (random.chance(0.3)) p.net.down.add(p.pkg.from.iss); else p.net.down.delete(p.pkg.from.iss); }],
      [2, () => { dest.state.flags.background = random.chance(0.75); }],
      [1, () => { if (crashed++ > 2) return; const pick = random.pick(['identity', 'keys', 'pins']);
        dest.ports[pick] = injectFaults({ ...original[pick] }, [{ method: { identity: 'activate', keys: 'rotate', pins: 'check' }[pick], when: 1, mode: random.pick(['throw', 'after']) }], { random }); }],
    ];
    const total = ops.reduce((sum, [w]) => sum + w, 0), pickOp = () => { let x = random.next() * total; for (const [w, fn] of ops) if ((x -= w) < 0) return fn; return ops.at(-1)[1]; };
    let everActive = false, everBound = false;
    const observe = async () => {
      const record = await dest.get(), src = await source.get(), account = await dest.identityRecord();
      if (record?.sourceBound) everBound = true;
      if (record?.state === 'active') {
        everActive = true;
        assert.equal(src?.state, 'committed', 'active only after the source committed');
        assert.equal(record.attestation, src.attestation, 'the attestation is the one the source signed');
        assert.equal(account.status, 'active');
      } else {
        // A crash between the identity commit and its stage record leaves the identity active while the transfer-in
        // is still activating; that is only possible after rotation and the fresh certification key, and the next
        // step records it (the fence keeps every other key operation refused meanwhile).
        if (account?.status === 'active') assert.ok(record?.state === 'activating' && record.stages.rotate && record.stages.certification, 'the identity is active only after rotation, in activation');
        // From the begin on (the account store then holds the transfer-in record), nothing is minted before activation.
        if (record) await assert.rejects(dest.registry.ensure(OWNER, 'signing'), { code: 'transfer_in_pending' }, 'nothing is minted before activation');
      }
      if (src?.state === 'committed') assert.ok(!['refused', 'cancelled', 'failed'].includes(record?.state), 'a committed source never strands the identity at the destination');
      const rotations = (await dest.registry.history(OWNER, { purpose: 'signing' })).filter(key => key.rotation === TRANSFER_IN_ROTATION);
      assert.ok(rotations.length <= 1, 'at most one activation rotation');
      if (['refused', 'cancelled', 'failed'].includes(record?.state)) assert.equal(await dest.metadata.get('signing-key'), undefined, 'no custody after a terminal state');
    };
    for (let i = 0; i < 40; i++) { await pickOp()(); await observe(); }
    // Recovery: faults heal, the network returns, the kill switch is released and time passes.
    Object.assign(dest.ports, original); p.served.moveDown = false; p.net.down.clear(); dest.state.flags.background = true;
    for (let i = 0; i < 12; i++) { p.clock.advance(random.pick([HOUR, 25 * HOUR, 3 * DAY])); await swallow(() => source.step()); await swallow(() => dest.step()); await observe(); }
    const record = await dest.get(), src = await source.get();
    if (record?.state === 'active') outcomes.active++; if (['refused', 'cancelled', 'failed'].includes(record?.state)) outcomes.ended++; if (crashed) outcomes.faults++;
    if (src?.state === 'committed') {
      assert.equal(record?.state, 'active', 'after healing, a committed source always ends active at the destination');
      const history = await dest.registry.history(OWNER, { purpose: 'signing' }), current = history.find(key => key.current);
      assert.equal(current.predecessor, 'kid-1'); assert.equal(history.find(key => key.kid === 'kid-1').state, 'retired');
      const doc = await dest.document(), chain = await verifyChain({ moves: doc.moves, keys: doc.keys.filter(key => key.use === 'sig'), iss: doc.iss, identity: record.to.identity, attestationKeys: async issuer => (await dest.client.attestationKeys(issuer)).jwks });
      assert.equal(chain.head.seq, 1);
    }
    if (everActive) assert.ok(everBound);
  } finally { for (const fn of hooks.reverse()) await fn(); }
}

test('seeded chaos: transfer-in against the real source stays consistent under faults, outages and concurrency', async () => {
  await forEachSeed(Number(process.env.CHAOS_SEEDS ?? 10), schedule);
  for (const name of ['active', 'ended', 'faults']) assert.ok(outcomes[name] > 0, `no ${name} schedule: the chaos run is vacuous`);
});
