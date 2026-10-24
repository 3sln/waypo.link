// Wargame F-07 (2026-10-23): same-host member keys are verified cache-only (org/cert/keys/*, TTL 300 s). Before the fix,
// background discovery ran at most once a minute over at most 64 roster entries and the refresh queue held 256 rows,
// so beyond ~160 members honest members got the uniform invalid_grant most of the time. Now the discovery batch scales
// with the roster, the queue is time-ordered (packages/orgs/key-refresh.mjs), and joins, epoch observations and
// same-host issuance hints enqueue at once. Engine level (MemberContextService over SqliteMetadata).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { MemberContextService, cachedIssuerKeys, memberDiscoveryBatch, memberRefreshLimit, MEMBER_TOKENS_PER_MEMBERSHIP } from '../packages/orgs/certificates.mjs';
import { enqueueMemberKeyRefresh, dueMemberKeyRefreshes, removeMemberKeyRefresh, rescheduleMemberKeyRefresh, MEMBER_REFRESH_PREFIX, MEMBER_REFRESH_INDEX, MEMBER_REFRESH_SIZE, MEMBER_REFRESH_CLAIMED, MEMBER_REFRESH_CLAIMED_INDEX } from '../packages/orgs/key-refresh.mjs';
import { forEachSeed } from './helpers/chaos.mjs';

const ISS = 'https://3sln.example', ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const uuid = n => { const h = n.toString(16).padStart(12, '0'); return `0000${h.slice(0, 4)}-0000-4000-8000-${h}`; };
const keysOf = sub => ({ identity: `${ISS}/identity/${sub}`, signing: null, keys: [{ kid: 'cert-1', state: 'active', publicJwk: { x: 'x'.repeat(43), y: 'y'.repeat(43) } }] });
function org({ n, paginated = false, members = null }) {
  const metadata = new SqliteMetadata(':memory:'); let now = 1_800_000_000_000; const clock = () => now, reads = [];
  const roster = Array.from({ length: n }, (_, i) => ({ iss: ISS, sub: uuid(i + 1) }));
  const live = members ?? new Set(roster.map(p => p.sub));
  const local = cachedIssuerKeys({ metadata, issuer: ISS, clock, read: async sub => { reads.push(sub); return keysOf(sub); } });
  const rosterPort = paginated ? async ({ after = '', limit = 1000 } = {}) => { const start = after ? roster.findIndex(p => p.sub === after) + 1 : 0, page = roster.slice(start, start + limit); return { principals: page, next: start + limit < roster.length ? page.at(-1).sub : null, total: roster.length }; } : async () => roster;
  const service = new MemberContextService({ metadata, organization: { id: ORG, identity: `${ISS}/identity/${ORG}` }, issuer: ISS, local, members: { roster: rosterPort, lookup: async p => live.has(p.sub) ? { id: 'm' + p.sub.replaceAll('-', '').slice(-20), generation: 1, aep: 0 } : null }, clock, flags: { organizations: () => true } });
  return { metadata, service, local, roster, reads, advance: ms => { now += ms; }, now: () => now, close: () => metadata.close() };
}
const resolvable = async (o, sub) => Boolean(await o.local.resolve({ issuer: ISS, subject: sub, kid: 'cert-1' }));

for (const paginated of [false, true]) test(`F-07: with the members a Business plan sells (500), members' keys stay resolvable (${paginated ? 'paginated' : 'array'} roster)`, { timeout: 300000 }, async () => {
  const o = org({ n: 500, paginated }); let samples = 0, hits = 0;
  try {
    // Steady traffic: a token request (and so a post-answer refreshDue) every 2 seconds for 40 minutes.
    for (let t = 0; t < 2400; t += 2) {
      o.advance(2000); await o.service.refreshDue();
      if (t >= 1200 && t % 60 === 0) for (const m of o.roster) { samples++; if (await resolvable(o, m.sub)) hits++; }
    }
  } finally { o.close(); }
  const rate = hits / samples;
  assert.ok(rate >= 0.99, `only ${(rate * 100).toFixed(1)}% of member keys resolvable; the rest get invalid_grant`);
});

test('F-07: discovery batch and refresh limit scale with the roster', () => {
  assert.equal(memberDiscoveryBatch(0), 64); assert.equal(memberDiscoveryBatch(500), 400); assert.equal(memberDiscoveryBatch(5000), 4000); assert.equal(memberDiscoveryBatch(50000), 8192);
  assert.equal(memberRefreshLimit(10), 16); assert.equal(memberRefreshLimit(5000), 79); assert.equal(memberRefreshLimit(100000), 128);
});

test('F-07: a same-host issuance hint warms a live member at once and answers the same for a non-member', async () => {
  const o = org({ n: 3 });
  try {
    assert.deepEqual(await o.service.hint({ subject: uuid(2) }), { accepted: true });
    assert.ok(await resolvable(o, uuid(2)), 'the member\'s key is cached right after the hint');
    const before = o.reads.length;
    assert.deepEqual(await o.service.hint({ subject: uuid(999) }), { accepted: true });
    assert.ok(!o.reads.slice(before).includes(uuid(999)), 'a non-member is not refreshed through the hint');
    await assert.rejects(o.service.hint({ subject: 'not-a-uuid' }), { code: 'invalid_request' });
  } finally { o.close(); }
});

test('F-07: a join or epoch enqueue (ORG-2, inside its own transaction) is due at once and picked up by refreshDue', async () => {
  const o = org({ n: 0, members: new Set([uuid(7)]) });
  try {
    await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(7) }, { now: o.now() }));
    await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(7) }, { now: o.now() }));
    assert.equal((await o.metadata.list({ prefix: MEMBER_REFRESH_PREFIX })).size, 1, 'deduplicated per principal');
    assert.equal((await o.service.refreshDue()).done, 1); assert.ok(await resolvable(o, uuid(7)));
    assert.equal((await o.metadata.list({ prefix: MEMBER_REFRESH_PREFIX })).size, 0);
  } finally { o.close(); }
});

test('F-07: request-path (claimed) entries are bounded; member entries are not crowded out by them', async () => {
  const o = org({ n: 0 });
  try {
    for (let i = 0; i < MEMBER_REFRESH_CLAIMED + 20; i++) await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(10000 + i) }, { now: o.now(), source: 'claimed' }));
    assert.deepEqual(await o.metadata.get(MEMBER_REFRESH_SIZE), { member: 0, claimed: MEMBER_REFRESH_CLAIMED });
    assert.equal(await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(1) }, { now: o.now(), cap: 10 })), true);
    assert.equal((await o.metadata.list({ prefix: MEMBER_REFRESH_PREFIX })).size, MEMBER_REFRESH_CLAIMED + 1);
  } finally { o.close(); }
});

test('F-07 chaos: the refresh queue keeps one row per principal, its index and size counter consistent, and stays bounded', () => forEachSeed(10, async random => {
  const metadata = new SqliteMetadata(':memory:'); let now = 1_000_000;
  try {
    const subs = Array.from({ length: 24 }, (_, i) => uuid(i + 1)), cap = 12;
    for (let step = 0; step < 300; step++) {
      const action = random.int(4), sub = random.pick(subs);
      if (action === 0) await metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub }, { now: now + random.int(5000), source: random.chance(0.5) ? 'claimed' : 'member', cap }));
      else if (action === 1) { const due = await metadata.transaction(tx => dueMemberKeyRefreshes(tx, now, 1 + random.int(4))); for (const [key] of due) await metadata.transaction(tx => random.chance(0.5) ? removeMemberKeyRefresh(tx, key) : rescheduleMemberKeyRefresh(tx, key, { dueAt: now + random.int(10000), attempts: 1 })); }
      else now += random.int(3000);
      const rows = [...await metadata.list({ prefix: MEMBER_REFRESH_PREFIX })], index = [...await metadata.list({ prefix: MEMBER_REFRESH_INDEX })], size = await metadata.get(MEMBER_REFRESH_SIZE) ?? { member: 0, claimed: 0 };
      const principals = rows.map(([, r]) => r.subject);
      assert.equal(new Set(principals).size, principals.length, 'one row per principal');
      assert.equal(index.length, rows.length, 'index matches rows'); for (const [, key] of index) assert.ok(rows.some(([k]) => k === key), 'index points at a live row');
      assert.equal(size.member, rows.filter(([, r]) => r.source === 'member').length); assert.equal(size.claimed, rows.filter(([, r]) => r.source === 'claimed').length);
      assert.ok(size.member <= cap && size.claimed <= MEMBER_REFRESH_CLAIMED, 'bounded');
      const claimedIndex = [...await metadata.list({ prefix: MEMBER_REFRESH_CLAIMED_INDEX })];
      assert.equal(claimedIndex.length, size.claimed, 'one claimed-index entry per claimed row');
      for (const [, queueKey] of claimedIndex) assert.equal((await metadata.get(queueKey))?.source, 'claimed', 'the claimed index points at live claimed rows');
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1][1].dueAt <= rows[i][1].dueAt, 'time-ordered keys');
    }
  } finally { metadata.close(); }
}));

test('item 7: member-context token() counts only live rows and its expired-row cleanup survives a refusal', async () => {
  const metadata = new SqliteMetadata(':memory:'); let now = 2_000_000_000_000;
  try {
    const service = new MemberContextService({ metadata, organization: { id: ORG, identity: `${ISS}/identity/${ORG}` }, issuer: ISS, clock: () => now, flags: { organizations: () => true } });
    let n = 0; service.admitToken = async () => ({ context: { membership: { id: 'm-member-000000000001', generation: 1 }, principal: { iss: ISS, sub: uuid(1) }, client: { client_id: 'https://app.example/c' }, jkt: 'j'.repeat(43), aep: 0, certificate: { jti: 'jti-' + (++n) } }, exp: Math.floor(now / 1000) + 600, expiresIn: 600 });
    // 4100 expired rows of other memberships: before the fix they counted toward MEMBER_TOKEN_LIMIT and the refusal
    // rolled their deletion back, so the organization stayed locked.
    await metadata.transaction(async tx => { for (let i = 0; i < 4100; i++) await tx.put('org/cert/token/expired-' + String(i).padStart(5, '0'), { membership: 'other-' + i, exp: Math.floor(now / 1000) - 10, createdAt: now - 1e6 }); });
    assert.ok((await service.token({})).access_token);
    assert.equal((await metadata.list({ prefix: 'org/cert/token/expired-' })).size, 0, 'expired rows are pruned');
    for (let i = 0; i < MEMBER_TOKENS_PER_MEMBERSHIP + 5; i++) await service.token({});
    assert.equal((await metadata.list({ prefix: 'org/cert/token/' })).size, MEMBER_TOKENS_PER_MEMBERSHIP, 'per-membership cap evicts the oldest');
  } finally { metadata.close(); }
});

test('item 5: the runtime membership port judges expiry by the writer\'s injected clock and reads the split roster', async () => {
  const { membershipPort } = await import('../packages/runtime/account/member-certificates.mjs');
  const { ORG_KEYS } = await import('../packages/orgs/roster.mjs');
  const { principalKey } = await import('../packages/orgs/grants.mjs');
  const metadata = new SqliteMetadata(':memory:'); let now = Date.now() + 365 * 86400000;
  try {
    const sub = uuid(5), expires = Math.floor(Date.now() / 1000) + 86400;
    await metadata.put('org/record-v1', { kind: 'organization', id: ORG, roster: { v: 2, live: 1 } });
    await metadata.put(ORG_KEYS.member + principalKey({ iss: ISS, sub }), { id: 'm-member-000000000005', principal: { iss: ISS, sub }, state: 'live', generation: 1, aep: 0, expires_at: expires });
    const port = membershipPort({ metadata, config: { LIFECYCLE_CLOCK: () => now } }, ORG);
    assert.equal(await port.lookup({ iss: ISS, sub }), null, 'expired by the writer\'s clock (a year ahead), though not by Date.now()');
    assert.deepEqual((await port.roster({})).principals, []);
    now = Date.now();
    assert.deepEqual(await port.lookup({ iss: ISS, sub }), { id: 'm-member-000000000005', generation: 1, aep: 0 });
    const page = await port.roster({ limit: 10 }); assert.deepEqual(page.principals, [{ iss: ISS, sub }]); assert.equal(page.total, 1); assert.equal(page.next, null);
  } finally { metadata.close(); }
});

// Review follow-up 1 (2026-10-23): request-path claims run before any signature or membership check, so they must not
// leave durable rows. A 'claimed' refresh stores no negative row; every stored row is indexed by expiry and pruned; and
// the claimed set is bounded with eviction (the newest claims always get in).
test('follow-up 1: unauthenticated claims cannot grow the key cache; expired rows are pruned', async () => {
  const metadata = new SqliteMetadata(':memory:'); let now = 1_800_000_000_000; const clock = () => now, known = new Set();
  const local = cachedIssuerKeys({ metadata, issuer: ISS, clock, read: async sub => known.has(sub) ? keysOf(sub) : null });
  const service = new MemberContextService({ metadata, organization: { id: ORG, identity: `${ISS}/identity/${ORG}` }, issuer: ISS, local, members: { lookup: async () => null }, clock, flags: { organizations: () => true } });
  const rows = async prefix => (await metadata.list({ prefix })).size;
  try {
    for (let i = 0; i < 64; i++) await metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(90000 + i) }, { now, source: 'claimed' }));
    await service.refreshDue({ limit: 128 });
    assert.equal(await rows('org/cert/keys/'), 0, 'a claimed refresh of an unknown subject stores no negative row, even briefly');
    for (let wave = 0; wave < 4; wave++) {
      for (let i = 0; i < 256; i++) await metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(wave * 1000 + i) }, { now, source: 'claimed' }));
      for (let k = 0; k < 10; k++) { await service.refreshDue({ limit: 128 }); now += 60000; }
      await service.sweep();
    }
    assert.equal(await rows('org/cert/keys/'), 0, 'no negative rows for claimed principals');
    assert.equal(await rows(MEMBER_REFRESH_PREFIX), 0);
    // Claimed principals that do have keys get positive rows, which the expiry index prunes once they expire.
    for (let i = 0; i < 40; i++) { known.add(uuid(50000 + i)); await metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(50000 + i) }, { now, source: 'claimed' })); }
    await service.refreshDue({ limit: 128 });
    assert.equal(await rows('org/cert/keys/'), 40);
    now += 301000; await service.refreshDue({ limit: 1 });
    assert.equal(await rows('org/cert/keys/'), 0, 'expired rows are pruned by the background run');
    assert.equal(await rows('org/cert/keys-due/'), 0);
  } finally { metadata.close(); }
});
test('follow-up 1: a full claimed set evicts its oldest entry instead of refusing', async () => {
  const o = org({ n: 0 });
  try {
    for (let i = 0; i < MEMBER_REFRESH_CLAIMED + 20; i++) { await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(10000 + i) }, { now: o.now(), source: 'claimed' })); o.advance(1); }
    const subjects = [...(await o.metadata.list({ prefix: MEMBER_REFRESH_PREFIX })).values()].map(r => r.subject);
    assert.equal(subjects.length, MEMBER_REFRESH_CLAIMED);
    assert.ok(subjects.includes(uuid(10000 + MEMBER_REFRESH_CLAIMED + 19)), 'the newest claim is queued');
    assert.ok(!subjects.includes(uuid(10000)), 'the oldest claim was evicted');
    assert.equal((await o.metadata.list({ prefix: MEMBER_REFRESH_CLAIMED_INDEX })).size, MEMBER_REFRESH_CLAIMED);
    // Upgrading a claimed row to a member row leaves the claimed index.
    await o.metadata.transaction(tx => enqueueMemberKeyRefresh(tx, { iss: ISS, sub: uuid(10000 + MEMBER_REFRESH_CLAIMED + 19) }, { now: o.now() }));
    assert.equal((await o.metadata.list({ prefix: MEMBER_REFRESH_CLAIMED_INDEX })).size, MEMBER_REFRESH_CLAIMED - 1);
    assert.deepEqual(await o.metadata.get(MEMBER_REFRESH_SIZE), { member: 1, claimed: MEMBER_REFRESH_CLAIMED - 1 });
  } finally { o.close(); }
});

// Review follow-up 8 (finishing item 5): the runtime's member-context verifier and its key cache read the writer's
// injected clock, like the membership port, so expiry is judged on one clock.
test('follow-up 8: the runtime verifier and key cache use the writer\'s injected clock', async () => {
  const { memberContextService } = await import('../packages/runtime/account/member-certificates.mjs');
  const metadata = new SqliteMetadata(':memory:'); let now = Date.now() + 3600000;
  try {
    const c = { metadata, config: { APP_ORIGIN: ISS, LIFECYCLE_CLOCK: () => now } }, service = memberContextService(c, ORG);
    assert.equal(service.clock(), now);
    const sub = uuid(8); await metadata.put('org/cert/keys/' + encodeURIComponent(JSON.stringify([ISS, sub])), { ...keysOf(sub), keys: keysOf(sub).keys.map(k => ({ kid: k.kid, state: k.state, publicJwk: k.publicJwk })), until: Date.now() + 60000 });
    assert.equal(await service.local.resolve({ issuer: ISS, subject: sub, kid: 'cert-1' }), null, 'expired on the writer\'s clock, though not on Date.now()');
    now = Date.now(); assert.ok(await service.local.resolve({ issuer: ISS, subject: sub, kid: 'cert-1' }));
  } finally { metadata.close(); }
});
