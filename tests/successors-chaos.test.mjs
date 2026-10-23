// PORT-5 seeded network chaos (identity-portability design §10.3, "Network"): N simulated providers with random move
// sequences, including returns, unattested moves, an equivocating source, a lapsed domain republishing a new
// attestation root, providers going down and verifiers refreshing, presenting and meeting identities in random order.
// Invariants: pins are monotonic in `seq`; the origin principal never changes; nothing is adopted automatically
// without both signatures; an adopted chain is always a prefix of the identity's genuine history; equivocation leaves
// the identity contested with its pin unchanged; a verifier that pinned a provider before it lapsed never adopts a
// record attested under the lapsed root. Rerun a failing seed with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { metadataStore } from '../packages/app/memory-providers.mjs';
import { forEachSeed, fakeClock } from './helpers/chaos.mjs';
import { World } from './helpers/portability-network.mjs';
import { SuccessorRegistry, portabilityClient } from '../packages/identity/successors.mjs';
import { signMoveStatement, parseMoveStatement, parseMoveAttestation, statementDigest } from '../packages/identity/succession.mjs';

const HOUR = 3600000, DAY = 86400000;
const seen = { adopted: 0, contested: 0, pending: 0, lapses: 0, firstUseResidual: 0 };
const ORIGINS = ['https://p0.example', 'https://p1.example', 'https://p2.example', 'https://p3.example'], ATTACKER = 'https://z.example';

async function schedule(random) {
  const clock = fakeClock(Date.UTC(2026, 9, 22)), world = new World({ clock }), dbs = [];
  try {
    const hosts = []; for (const origin of ORIGINS) hosts.push(await world.provider(origin));
    const attacker = await world.provider(ATTACKER);
    const log = event => { if (event.action === 'successor-adopted') seen.adopted++; if (event.action === 'successor-contested') seen.contested++; if (event.action === 'successor-pending') seen.pending++; };
    const verifier = () => { const db = new SqliteMetadata(':memory:'); dbs.push(db); return new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: world.net.fetch, clock: clock.now }), enabled: () => true, clock: clock.now, log }); };
    const verifiers = [verifier(), verifier()], fresh = verifier();
    // Identities, their genuine history and where they live.
    const people = [];
    for (let i = 0; i < 3; i++) {
      const id = await world.identity(), home = random.pick(hosts); world.host(home, id);
      const origin = { iss: home.origin, sub: id.sub }, person = { id, origin, host: home, genuine: [], keysAt: [] };
      for (const v of verifiers) await v.track({ origin, identity: home.state.get(id.sub).identity, signing: { kid: id.current.kid, publicJwk: id.current.pair.publicJwk } });
      people.push(person);
    }
    const genuineKids = new Map(hosts.map(host => [host.origin, new Set(host.set.keys.map(key => key.kid))])), lapsed = new Map(), pinnedAtLapse = new Map();
    const pinsBefore = new Map();
    const snapshot = async () => { for (const [vi, v] of verifiers.entries()) for (const person of people) { const pin = await v.pin(person.origin); pinsBefore.set(`${vi}|${person.id.sub}`, pin && { seq: pin.head.seq, status: pin.status, chain: pin.chain.map(r => r.statement) }); } };
    const ops = [
      [6, async () => { // a genuine move (sometimes unattested, sometimes back to an earlier host)
        const person = random.pick(people), to = random.pick(hosts.filter(host => host !== person.host)); if (person.genuine.length >= 6) return;
        person.keysAt.push({ key: person.id.current, from: person.host, seq: person.genuine.length + 1, prev: person.genuine.at(-1) });
        const record = await world.move(person.id, person.host, to, { attest: random.chance(0.85) });
        person.genuine.push(record); person.host = to;
      }],
      [3, async () => { // equivocation: the source attests a second destination for a past position
        const person = random.pick(people), v = random.pick(verifiers), head = (await v.pin(person.origin)).head.seq;
        const candidates = person.keysAt.filter(entry => entry.seq <= head && !lapsed.has(entry.from.origin)), at = candidates.length ? random.pick(candidates) : null; if (!at) return;
        const from = parseMoveStatement(person.genuine[at.seq - 1].statement).payload.from, to = { iss: ATTACKER, identity: `${ATTACKER}/identity/${person.id.sub}` };
        const statement = await signMoveStatement({ kid: at.key.kid, payload: { bindle: 'identity-move', v: 1, sub: person.id.sub, kind: 'person', seq: at.seq, prev: at.prev ? await statementDigest(parseMoveStatement(at.prev.statement).input) : null, from, to, iat: 1800000000 } }, at.key.pair.privateKey);
        const attestation = await at.from.attest({ bindle: 'move-attestation', v: 1, iss: from.iss, sub: person.id.sub, seq: at.seq, statement: await statementDigest(parseMoveStatement(statement).input), to, aep: 1, at: 1 });
        await snapshot();
        const outcome = await v.adopt(person.origin, [{ statement, attestation }]);
        assert.notEqual(outcome.outcome, 'adopted', 'a forged destination is never adopted');
      }],
      [1, async () => { // a lapsed domain: new root, then an attacker with an old key forges a move from it
        const host = random.pick(hosts); if (lapsed.has(host.origin)) return;
        lapsed.set(host.origin, new Set(genuineKids.get(host.origin)));
        for (const [vi, v] of verifiers.entries()) pinnedAtLapse.set(`${vi}|${host.origin}`, Boolean(await v.pins.read(host.origin)));
        await host.lapse(); seen.lapses++;
        const victim = people.find(person => person.keysAt.some(at => at.from === host));
        if (!victim) return;
        const at = victim.keysAt.find(entry => entry.from === host), from = parseMoveStatement(victim.genuine[at.seq - 1].statement).payload.from, to = { iss: ATTACKER, identity: `${ATTACKER}/identity/${victim.id.sub}` };
        const statement = await signMoveStatement({ kid: at.key.kid, payload: { bindle: 'identity-move', v: 1, sub: victim.id.sub, kind: 'person', seq: at.seq, prev: at.prev ? await statementDigest(parseMoveStatement(at.prev.statement).input) : null, from, to, iat: 1800000000 } }, at.key.pair.privateKey);
        const attestation = await host.attest({ bindle: 'move-attestation', v: 1, iss: host.origin, sub: victim.id.sub, seq: at.seq, statement: await statementDigest(parseMoveStatement(statement).input), to, aep: 1, at: 1 });
        attacker.state.set(victim.id.sub, { status: 'active', identity: to.identity, moves: [...victim.genuine.slice(0, at.seq - 1), { statement, attestation }], keys: victim.id.documentKeys(), document() { return { v: 1, iss: ATTACKER, sub: victim.id.sub, kind: 'person', keys: this.keys, moves: this.moves }; } });
        host.state.set(victim.id.sub, { ...host.state.get(victim.id.sub) ?? { identity: from.identity }, status: 'moved', moved: { statement, attestation } });
      }],
      [1, async () => { const host = random.pick(hosts); if (lapsed.has(host.origin)) return; await host.rotateAttestation(); genuineKids.get(host.origin).add(host.set.current); }],
      [8, async () => { const v = random.pick(verifiers), person = random.pick(people); await snapshot(); await v.refresh(person.origin); }],
      [3, async () => { const v = random.pick(verifiers), person = random.pick(people), entry = person.host.state.get(person.id.sub); if (entry?.moves?.length) { await snapshot(); await v.present({ moves: entry.moves }); await v.drain(); } }],
      [2, async () => { const person = random.pick(people), entry = person.host.state.get(person.id.sub); if (entry?.status === 'active') await fresh.firstContact({ iss: person.host.origin, sub: person.id.sub, purpose: random.pick(['origin-linking', null]) }); }],
      [3, async () => { const host = random.pick(hosts); if (random.chance(0.5)) world.net.down.add(host.origin); else world.net.down.delete(host.origin); }],
      [4, async () => { clock.advance(random.pick([HOUR / 2, 2 * HOUR, DAY, 8 * DAY])); }],
    ];
    const total = ops.reduce((sum, [w]) => sum + w, 0), pickOp = () => { let x = random.next() * total; for (const [w, fn] of ops) if ((x -= w) < 0) return fn; return ops.at(-1)[1]; };
    const check = async () => {
      for (const [vi, v] of verifiers.entries()) for (const person of people) {
        const pin = await v.pin(person.origin), before = pinsBefore.get(`${vi}|${person.id.sub}`);
        assert.deepEqual(pin.origin, person.origin, 'the origin principal never changes');
        if (before) {
          assert.ok(pin.head.seq >= before.seq, 'pins are monotonic in seq');
          if (before.status === 'contested') { assert.equal(pin.status, 'contested'); assert.equal(pin.head.seq, before.seq, 'a contested pin does not move'); }
        }
        for (const [i, record] of pin.chain.entries()) {
          assert.notEqual(record.attestation, null, 'no automatic adoption without both signatures');
          const attestation = parseMoveAttestation(record.attestation), issuer = attestation.payload.iss;
          const forged = lapsed.has(issuer) && !lapsed.get(issuer).has(attestation.header.kid) && !genuineKids.get(issuer).has(attestation.header.kid);
          // The accepted P16 residual: only a verifier that had never pinned the lapsed host's keys can be fooled.
          if (forged) { seen.firstUseResidual++; assert.equal(pinnedAtLapse.get(`${vi}|${issuer}`), false, 'a verifier that pinned the host before it lapsed never adopts under the new root'); break; }
          assert.equal(record.statement, person.genuine[i]?.statement, 'an adopted chain is a prefix of the genuine history');
        }
      }
    };
    for (let i = 0; i < 45; i++) { await pickOp()(); await check(); }
    // Heal the network and let every verifier catch up.
    world.net.down.clear(); clock.advance(2 * HOUR);
    for (const v of verifiers) for (const person of people) { await snapshot(); await v.refresh(person.origin); await check(); }
  } finally { for (const db of dbs) db.close(); }
}

test('seeded network chaos: verifier pins stay monotonic, attested and genuine across moves, returns, equivocation and lapsed domains', async () => {
  await forEachSeed(Number(process.env.CHAOS_SEEDS ?? 8), schedule);
  // The schedule must actually exercise adoption, contests, pending successors and lapsed domains.
  for (const name of ['adopted', 'contested', 'pending', 'lapses']) assert.ok(seen[name] > 0, `no ${name} happened: the chaos schedule is vacuous`);
});
