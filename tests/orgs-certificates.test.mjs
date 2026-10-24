// ORG-4 at the ORGANIZATION's provider (packages/orgs/certificates.mjs), engine level, against real certificates from
// the same-host home issuer (packages/identity/member-certificates.mjs): the token form, the BindleMember direct form,
// DPoP-bound member-context tokens, `bindle_member`, adversarial certificates and proofs, uniform failure (R2-H1:
// identical result for not-a-member, not-connected and every verification failure, with equal verification cost and
// no request-path fetch), `aep` resets and regressions, cross-organization confusion, and seeded chaos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { createAppEngine, perform, read } from '../packages/app/engine.mjs';
import { memoryAudit } from '../packages/app/providers.mjs';
import { IdentityKeyRegistry } from '../packages/identity/keys.mjs';
import { MemberCertificateIssuer, certificationSigner, certificationKeyList, parseMemberCertificate, signMemberPop, MEMBER_PURPOSES, MEMBER_CERTIFICATE_MEMBERS } from '../packages/identity/member-certificates.mjs';
import { DELEGATION_TYP } from '../packages/identity/delegation.mjs';
import { MemberContextService, memberContextProvider, cachedIssuerKeys, memberPrincipalKey, MemberToken, MemberDirect, MemberAuthenticate, EndMemberTokens, MemberKeyRefresh, MemberCertificateSettings, SetMemberCertificateSettings, MEMBER_FAILURE_LIMITS, MEMBER_TOKEN_FAILURE, MEMBER_DIRECT_FAILURE } from '../packages/orgs/certificates.mjs';
import { fakeClock, forEachSeed, concurrently } from './helpers/chaos.mjs';
import { holder, dpop, jws, sealing, registryStore, countingCrypto } from './helpers/member-certificates.mjs';
import { base64url, textEncoder } from '../packages/core/records.mjs';

const ISSUER = 'https://3sln.example', TOKEN_URL = `${ISSUER}/oauth/token`, RPC = `${ISSUER}/bindle/rpc`;
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ORG2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ERP = { client_id: 'https://erp.example/client.json', origin: 'https://erp.example' }, CRM = { client_id: 'https://crm.example/client.json', origin: 'https://crm.example' };
const identityOf = sub => `${ISSUER}/identity/${sub}`, ACCESS = [MEMBER_PURPOSES.access];
const failure = error => ({ code: error?.code, status: error?.status, message: error?.message });

/** Counts write operations on an organization's store (review LM1/F1: the request path writes nothing for anyone). */
function instrument(o) {
  const tx = o.metadata.transaction.bind(o.metadata), put = o.metadata.put.bind(o.metadata), del = o.metadata.delete?.bind(o.metadata); let writes = 0;
  o.metadata.transaction = fn => tx(t => fn({ get: k => t.get(k), list: a => t.list(a), delete: k => { writes++; return t.delete(k); }, put: (k, v) => { writes++; return t.put(k, v); } }));
  o.metadata.put = (k, v) => { writes++; return put(k, v); }; if (del) o.metadata.delete = k => { writes++; return del(k); };
  return () => { const n = writes; writes = 0; return n; };
}
async function world({ seed = 1, verifyCrypto } = {}) {
  const clock = fakeClock(1800000000000), people = new Map(), orgs = new Map();
  function person(sub) {
    if (!people.has(sub)) {
      const metadata = new SqliteMetadata(':memory:'), state = { aep: 0, status: 'active' };
      const keys = new IdentityKeyRegistry({ store: registryStore(metadata), ...sealing, clock: clock.now });
      const signer = certificationSigner({ metadata, ...sealing, clock: clock.now });
      const issuer = new MemberCertificateIssuer({ metadata, issuer: ISSUER, account: async () => ({ status: state.status }), authorityEpoch: async () => state.aep, identityURI: identityOf, signer, orgLifetime: async aud => { const org = [...orgs.values()].find(o => o.identity === aud); return org ? (await org.service.settings()).certificateSeconds : null; }, enabled: () => true, clock: clock.now });
      people.set(sub, { sub, metadata, state, keys, issuer, signer });
    }
    return people.get(sub);
  }
  function org(id) {
    if (!orgs.has(id)) {
      const metadata = new SqliteMetadata(':memory:'), memberships = new Map(), connections = new Map([[ERP.client_id, { origin: ERP.origin, state: 'active' }], [CRM.client_id, { origin: CRM.origin, state: 'active' }]]), flags = { organizations: true, foreign: false };
      const log = { observed: [], contexts: [], reads: 0, holds: [] };
      const members = {
        async roster() { return [...memberships.values()].filter(m => m.state === 'live').map(m => ({ ...m.principal })); },
        async lookup(principal) { const m = memberships.get(memberPrincipalKey(principal)); return m?.state === 'live' ? { id: m.id, generation: m.generation, aep: m.aep, ...m.label ? { label: m.label } : {} } : null; },
        async observe(principal, { aep, reset, addedUnder }) { log.observed.push({ principal, aep, reset, addedUnder }); const m = memberships.get(memberPrincipalKey(principal)); if (!m || m.state !== 'live') return null; if (aep < m.aep) throw Object.assign(new Error('stale'), { code: 'authority_epoch_stale' }); if (aep > m.aep || reset) { m.aep = aep; m.hold = true; log.holds.push(aep); } return m; },
        async context(principal, { client, generation }) { const m = memberships.get(memberPrincipalKey(principal)); if (!m || m.state !== 'live' || m.generation !== generation) throw Object.assign(new Error('gone'), { code: 'not_found' }); log.contexts.push(client); return { membership_id: m.id, generation: m.generation, aep: m.aep }; },
      };
      const local = cachedIssuerKeys({ metadata, issuer: ISSUER, clock: clock.now, read: async sub => { log.reads++; const p = people.get(sub); if (!p || p.state.status !== 'active') return null; const signing = await p.keys.current(sub, { purpose: 'signing' }); return { identity: identityOf(sub), signing: signing ? { kid: signing.kid, publicJwk: signing.publicJwk } : null, keys: await certificationKeyList(p.metadata, sub) }; } });
      const counted = verifyCrypto ?? countingCrypto();
      const service = new MemberContextService({ metadata, organization: { id, identity: identityOf(id) }, issuer: ISSUER, members, local, connections: { check: async ({ clientId, origin }) => { const c = connections.get(clientId); return Boolean(c && ['active', 'degraded'].includes(c.state) && c.origin === origin); } }, status: async ({ subject, jkt }) => (await person(subject).issuer.status(subject, jkt)).status, flags: { organizations: () => flags.organizations, foreign: () => flags.foreign }, clock: clock.now, crypto: counted.crypto });
      const engine = createAppEngine({ providers: { clock: { now: clock.now }, random: { uuid: () => crypto.randomUUID() }, audit: memoryAudit({ clock: { now: clock.now } }), memberContext: memberContextProvider(service) } });
      const add = (sub, extra = {}) => { const m = { id: (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '').slice(0, 32), principal: { iss: ISSUER, sub }, state: 'live', generation: 1, aep: 0, ...extra }; memberships.set(memberPrincipalKey(m.principal), m); return m; };
      orgs.set(id, { id, identity: identityOf(id), metadata, memberships, connections, flags, log, service, engine, counts: counted.counts, add, local });
    }
    return orgs.get(id);
  }
  const sys = o => ({ kind: 'system', owner: o.id });
  /** A genuine certificate for `sub` at organization `o` (consent first). */
  async function certify(sub, o, { client = ERP, key, purposes = ACCESS, lifetime } = {}) {
    const p = person(sub); key ??= await holder();
    await p.issuer.consent(sub, { kind: 'owner', owner: sub, client }, { aud: o.identity, purposes: [...new Set([...purposes, MEMBER_PURPOSES.access])].sort() });
    const proof = await signMemberPop({ privateKey: key.privateKey, aud: o.identity, clientId: client.client_id, iat: Math.floor(clock.now() / 1000), issuer: ISSUER, jkt: key.jkt, subject: sub });
    const issued = await p.issuer.issue(sub, { kind: 'app', owner: sub, client }, { aud: o.identity, purposes, delegate: key.jwk, proof, ...lifetime ? { lifetime } : {} });
    return { ...issued, key };
  }
  /** Primes the same-host key cache the way the background refresh does. */
  const warm = async (o, sub) => { await person(sub).signer(sub); await person(sub).keys.ensure(sub, 'signing'); return o.local.refresh({ issuer: ISSUER, subject: sub }); };
  const token = async (o, cert, { key = cert.key, clientId = ERP.client_id, htu = TOKEN_URL, proof, network = 'net-1' } = {}) => perform(o.engine, new MemberToken({ actor: sys(o), input: { assertion: cert.certificate, clientId, dpop: proof ?? await dpop(key, { htu, nowMs: clock.now() }), htu: TOKEN_URL, network } }));
  const direct = async (o, cert, { key = cert.key, htm = 'POST', htu = RPC, ath = cert.certificate, authorization = `BindleMember ${cert.certificate}`, ownerInterface, network = 'net-1' } = {}) => perform(o.engine, new MemberDirect({ actor: sys(o), input: { authorization, dpop: await dpop(key, { htm, htu, nowMs: clock.now(), ath }), htm: 'POST', htu: RPC, network, ...ownerInterface ? { ownerInterface } : {} } }));
  const use = async (o, accessToken, key, { htm = 'POST', htu = RPC, scheme = 'DPoP', ath = accessToken, network = 'net-1' } = {}) => perform(o.engine, new MemberAuthenticate({ actor: sys(o), input: { authorization: `${scheme} ${accessToken}`, dpop: await dpop(key, { htm, htu, nowMs: clock.now(), ath }), htm: 'POST', htu: RPC, network } }));
  return { clock, person, org, certify, warm, token, direct, use, sys };
}

test('token form: a DPoP-bound member-context token that never outlives the certificate, with bindle_member and no refresh token', async () => {
  const w = await world(), o = w.org(ORG), m = o.add(ALICE, { label: 'Alice' }); await w.warm(o, ALICE);
  const cert = await w.certify(ALICE, o), response = await w.token(o, cert);
  assert.deepEqual(Object.keys(response).sort(), ['access_token', 'bindle_member', 'expires_in', 'token_type']);
  assert.equal(response.token_type, 'DPoP'); assert.equal(response.refresh_token, undefined);
  assert.deepEqual(response.bindle_member, { entity: identityOf(ORG), id: m.id, label: 'Alice' });
  assert.ok(response.expires_in <= parseMemberCertificate(cert.certificate).payload.exp - Math.floor(w.clock.now() / 1000));
  assert.deepEqual(o.log.contexts, [ERP.client_id], 'ORG-2 learns the client for member-removed');
  // Complete signing-key provenance reaches ORG-2 (`addedUnder`): the identity signing key and the certification kid.
  const signing = await w.person(ALICE).keys.current(ALICE, { purpose: 'signing' }), header = JSON.parse(Buffer.from(cert.certificate.split('.')[0], 'base64url'));
  assert.deepEqual(o.log.observed.at(-1).addedUnder, { kid: signing.kid, publicKey: signing.publicJwk, certificationKid: header.kid, authentication: 'member-certificate', identity: identityOf(ALICE) });
  const admitted = await o.service.admitToken({ assertion: cert.certificate, clientId: ERP.client_id, dpop: await dpop(cert.key, { htu: TOKEN_URL, nowMs: w.clock.now() }), htu: TOKEN_URL });
  assert.deepEqual(Object.keys(admitted.member).sort(), ['addedUnder', 'aep', 'client', 'generation', 'membership_id', 'principal']); assert.equal(admitted.member.membership_id, m.id); assert.deepEqual(admitted.bindle_member, { entity: identityOf(ORG), id: m.id, label: 'Alice' });
  const used = await w.use(o, response.access_token, cert.key);
  assert.deepEqual(used.member, { entity: identityOf(ORG), id: m.id, label: 'Alice' }); assert.deepEqual(used.context.principal, { iss: ISSUER, sub: ALICE });
  // Bound to the certified key; Bearer is refused; ath must be the token; replays fail.
  const thief = await holder();
  await assert.rejects(w.use(o, response.access_token, thief), MEMBER_DIRECT_FAILURE.body.error === 'invalid_token' ? { code: 'invalid_token', status: 401 } : {});
  await assert.rejects(w.use(o, response.access_token, cert.key, { scheme: 'Bearer' }), { code: 'invalid_token', status: 401 });
  await assert.rejects(w.use(o, response.access_token, cert.key, { ath: 'other' }), { code: 'invalid_token' });
  // The token dies with the certificate.
  w.clock.advance((response.expires_in + 1) * 1000);
  await assert.rejects(w.use(o, response.access_token, cert.key), { code: 'invalid_token' });
});

test('direct form: Authorization BindleMember with a proof bound to the certificate (ath); owner-interface actions check home status', async () => {
  const w = await world(), o = w.org(ORG), m = o.add(ALICE); await w.warm(o, ALICE);
  const cert = await w.certify(ALICE, o), result = await w.direct(o, cert);
  assert.deepEqual(result.member, { entity: identityOf(ORG), id: m.id });
  await assert.rejects(w.direct(o, cert, { ath: 'not-the-certificate' }), { code: 'invalid_token', status: 401 });
  await assert.rejects(w.direct(o, cert, { authorization: `Bearer ${cert.certificate}` }), { code: 'invalid_token', status: 401 });
  // Step 4: a status check at home, failing closed once the key is revoked there.
  assert.ok((await w.direct(o, cert, { ownerInterface: true })).member);
  await w.person(ALICE).issuer.revokeKey(ALICE, { kind: 'owner', owner: ALICE }, { jkt: cert.key.jkt });
  await assert.rejects(w.direct(o, cert, { ownerInterface: true }), { code: 'invalid_token', status: 401 });
  // Non-owner-interface requests keep working until expiry (the issuer's disclosed lifetime bound, spec §5.2).
  assert.ok((await w.direct(o, cert)).member);
});

test('a member key cache miss fails uniformly without a request-path read or write and is warmed in the background', async () => {
  const w = await world(), o = w.org(ORG); o.add(ALICE);
  const cert = await w.certify(ALICE, o), writes = instrument(o);
  await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  assert.equal(o.log.reads, 0, 'no read of the member\'s account on the request path');
  // Review LM1 / F-07 / follow-up 3: a cache miss only remembers the claimed principal in memory; the bounded enqueue
  // runs in the background run, so the request path writes nothing for a member or a non-member.
  const member = writes(), bob = await w.certify(BOB, o); await assert.rejects(w.token(o, bob), { code: 'invalid_grant' });
  assert.equal(member, 0, 'no request-path write for a member'); assert.equal(writes(), 0, 'nor for a non-member');
  assert.equal(o.log.reads, 0);
  w.clock.advance(5000);
  assert.equal((await perform(o.engine, new MemberKeyRefresh({ actor: w.sys(o) }))).done, 2); assert.equal(o.log.reads, 2, 'both claimed principals are refreshed in the background');
  assert.ok((await w.token(o, cert)).access_token);
  assert.equal((await perform(o.engine, new MemberKeyRefresh({ actor: w.sys(o) }))).done, 0); assert.equal(o.log.reads, 2);
});

test('uniform failure (R2-H1): every rejection is the same invalid_grant, with equal verification cost for members and non-members', async () => {
  const w = await world(), o = w.org(ORG), o2 = w.org(ORG2), alice = o.add(ALICE); o2.add(ALICE); await w.warm(o, ALICE); await w.warm(o2, ALICE);
  const good = await w.certify(ALICE, o), parsed = parseMemberCertificate(good.certificate), readsBefore = o.log.reads;
  const forge = async (payload, header = parsed.header) => ({ certificate: await jws(header, payload, (await holder()).privateKey), key: good.key });
  await w.person(ALICE).keys.ensure(ALICE, 'signing');
  const signingKey = await w.person(ALICE).keys.privateKey(ALICE, 'signing'), signingKid = (await w.person(ALICE).keys.current(ALICE, { purpose: 'signing' })).kid;
  const otherKey = await holder();
  const cases = {
    'forged signature naming a member': await forge(parsed.payload),
    'forged signature naming a non-member': await forge({ ...parsed.payload, sub: BOB, identity: identityOf(BOB) }),
    'forged signature naming an unknown subject': await forge({ ...parsed.payload, sub: 'ffffffff-ffff-4fff-8fff-ffffffffffff', identity: identityOf('ffffffff-ffff-4fff-8fff-ffffffffffff') }),
    'signed by the identity signing key (R4-H1)': { certificate: await jws({ alg: 'ES256', kid: signingKid, typ: parsed.header.typ }, parsed.payload, signingKey.privateKey), key: good.key },
    'BindleBox delegation typ': { certificate: await jws({ ...parsed.header, typ: DELEGATION_TYP }, parsed.payload, otherKey.privateKey), key: good.key },
    'wrong audience (another organization on the same host)': await w.certify(ALICE, o2),
    'genuine non-member certificate': await w.certify(BOB, o),
    'wrong client (not connected)': await w.certify(ALICE, o, { client: { client_id: 'https://stranger.example/client.json', origin: 'https://stranger.example' } }),
    'identity URI not the pinned one (R2-H2)': await forge({ ...parsed.payload, identity: `${ISSUER}/people/${ALICE}` }),
    'malformed certificate': { certificate: 'a.b.c', key: good.key },
    'extra payload member': await forge({ ...parsed.payload, admin: true }),
    'purpose accept only': await w.certify(ALICE, o, { purposes: [MEMBER_PURPOSES.accept] }),
  };
  cases['proof by another key'] = { ...good, proofKey: otherKey };
  cases['proof for another URL'] = { ...good, htu: `${ISSUER}/oauth/other` };
  cases['client_id parameter differs'] = { ...good, clientId: CRM.client_id };
  const results = [];
  for (const [name, c] of Object.entries(cases)) {
    const before = o.counts.verify; let error;
    try { await w.token(o, c, { key: c.proofKey ?? c.key, htu: c.htu, clientId: c.clientId }); } catch (e) { error = e; }
    assert.ok(error, `${name} must fail`); results.push([name, failure(error), o.counts.verify - before]);
  }
  for (const [name, f] of results) assert.deepEqual(f, { code: 'invalid_grant', status: 400, message: 'invalid_grant' }, name);
  // Equal cost before the proof step: one signature verification for forgeries of members, non-members and unknowns.
  const cost = Object.fromEntries(results.map(([name, , n]) => [name, n]));
  assert.equal(cost['forged signature naming a member'], cost['forged signature naming a non-member']);
  assert.equal(cost['forged signature naming a member'], cost['forged signature naming an unknown subject']);
  assert.equal(cost['forged signature naming a member'], cost['malformed certificate']);
  assert.equal(cost['forged signature naming a member'], 1);
  assert.equal(o.log.reads, readsBefore, 'no request-path read for any rejection');
  assert.deepEqual(MEMBER_TOKEN_FAILURE, { status: 400, body: { error: 'invalid_grant' } });
  // Expiry, future iat and the effective-lifetime cap (R4-M3).
  const expiring = await w.certify(ALICE, o); w.clock.advance(661 * 1000 + 61 * 1000);
  await assert.rejects(w.token(o, expiring), { code: 'invalid_grant' });
  await perform(o.engine, new SetMemberCertificateSettings({ actor: { kind: 'owner', owner: ORG, entity: { kind: 'organization', id: ORG }, principal: { iss: ISSUER, sub: ALICE }, powers: ['admin'] }, input: { certificateSeconds: 120 } }));
  assert.deepEqual(await read(o.engine, new MemberCertificateSettings({ actor: { kind: 'owner', owner: ORG } })), { certificateSeconds: 120 });
  await w.warm(o, ALICE);
  const ok = await w.certify(ALICE, o); assert.equal(parseMemberCertificate(ok.certificate).payload.exp - parseMemberCertificate(ok.certificate).payload.iat, 120, 'the home issuer honours the organization setting');
  w.clock.advance(150 * 1000); await w.warm(o, ALICE);
  await assert.rejects(w.token(o, ok), { code: 'invalid_grant' });
  assert.equal(alice.state, 'live');
});

test('a certificate longer than the organization allows is treated as expired after the organization cap (R4-M3)', async () => {
  const w = await world(), o = w.org(ORG); o.add(ALICE); await w.warm(o, ALICE);
  const cert = await w.certify(ALICE, o); // 660 s
  await perform(o.engine, new SetMemberCertificateSettings({ actor: { kind: 'owner', owner: ORG, entity: { kind: 'organization', id: ORG }, principal: { iss: ISSUER, sub: ALICE }, powers: ['admin'] }, input: { certificateSeconds: 120 } }));
  assert.ok((await w.token(o, cert)).expires_in <= 120, 'the token never outlives the organization cap');
  w.clock.advance(181 * 1000); await w.warm(o, ALICE);
  await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  await assert.rejects(perform(o.engine, new SetMemberCertificateSettings({ actor: { kind: 'owner', owner: ORG, entity: { kind: 'organization', id: ORG }, principal: { iss: ISSUER, sub: BOB }, powers: [] }, input: { certificateSeconds: 300 } })), { code: 'not_found' });
  await assert.rejects(perform(o.engine, new SetMemberCertificateSettings({ actor: { kind: 'owner', owner: ORG, entity: { kind: 'organization', id: ORG }, principal: { iss: ISSUER, sub: ALICE }, powers: ['admin'] }, input: { certificateSeconds: 661 } })), { code: 'invalid_request' });
});

test('replayed proofs, replayed certificates with fresh proofs, and connection, membership and flag changes', async () => {
  const w = await world(), o = w.org(ORG), m = o.add(ALICE); await w.warm(o, ALICE);
  const cert = await w.certify(ALICE, o), proof = await dpop(cert.key, { htu: TOKEN_URL, nowMs: w.clock.now() });
  assert.ok((await w.token(o, cert, { proof })).access_token);
  await assert.rejects(w.token(o, cert, { proof }), { code: 'invalid_grant' }, 'a replayed proof jti');
  // A stolen certificate without the holder key is useless; the holder can mint again with a fresh proof.
  assert.ok((await w.token(o, cert)).access_token);
  w.clock.advance(61000); await assert.rejects(w.token(o, cert, { proof }), { code: 'invalid_grant' }, 'a stale proof');
  // The connection degraded keeps working; suspended or a wrong origin does not.
  o.connections.get(ERP.client_id).state = 'degraded'; assert.ok((await w.token(o, cert)).access_token);
  o.connections.get(ERP.client_id).state = 'suspended'; await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  o.connections.set(ERP.client_id, { origin: 'https://elsewhere.example', state: 'active' }); await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  o.connections.set(ERP.client_id, { origin: ERP.origin, state: 'active' });
  const live = await w.token(o, cert);
  // Ending the membership ends its tokens (§5.4) and every later certificate.
  m.state = 'ended'; await perform(o.engine, new EndMemberTokens({ actor: w.sys(o), input: { membership: m.id } }));
  await assert.rejects(w.use(o, live.access_token, cert.key), { code: 'invalid_token' });
  await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  // A rejoin is a new generation: tokens of the old generation never revive.
  m.state = 'live'; m.generation = 2; await assert.rejects(w.use(o, live.access_token, cert.key), { code: 'invalid_token' });
  assert.ok((await w.token(o, cert)).access_token);
  o.flags.organizations = false; await assert.rejects(w.token(o, cert), { code: 'invalid_grant' });
  await assert.rejects(perform(o.engine, new MemberToken({ actor: { kind: 'owner', owner: ORG }, input: {} })), { code: 'forbidden' });
});

test('aep: a higher epoch is an authority reset persisted by ORG-2; a lower one fails, and older tokens stop at once', async () => {
  const w = await world(), o = w.org(ORG), m = o.add(ALICE); await w.warm(o, ALICE);
  const old = await w.certify(ALICE, o), oldToken = await w.token(o, old);
  w.person(ALICE).state.aep = 1;
  const fresh = await w.certify(ALICE, o); assert.equal(parseMemberCertificate(fresh.certificate).payload.aep, 1);
  assert.ok((await w.token(o, fresh)).access_token);
  assert.equal(m.aep, 1); assert.deepEqual(o.log.holds, [1], 'the reset reached ORG-2 (governance hold)');
  await assert.rejects(w.token(o, old), { code: 'invalid_grant' }, 'a pre-reset certificate (R2-M1)');
  await assert.rejects(w.use(o, oldToken.access_token, old.key), { code: 'invalid_token' }, 'a pre-reset token');
  assert.deepEqual(o.log.holds, [1], 'replaying an old certificate never re-triggers a reset');
  // connection-revoked from home: tokens end and the reset is recorded.
  const t = await w.token(o, fresh);
  await perform(o.engine, new EndMemberTokens({ actor: w.sys(o), input: { principal: { iss: ISSUER, sub: ALICE }, reset: true } }));
  await assert.rejects(w.use(o, t.access_token, fresh.key), { code: 'invalid_token' }); assert.deepEqual(o.log.holds, [1, 1]);
});

test('cross-organization confusion: a certificate, token or proof for one organization never works at another', async () => {
  const w = await world(), o1 = w.org(ORG), o2 = w.org(ORG2); o1.add(ALICE); o2.add(ALICE); await w.warm(o1, ALICE); await w.warm(o2, ALICE);
  const for1 = await w.certify(ALICE, o1), t1 = await w.token(o1, for1);
  await assert.rejects(w.token(o2, for1), { code: 'invalid_grant' });
  await assert.rejects(w.use(o2, t1.access_token, for1.key), { code: 'invalid_token' });
  await assert.rejects(w.direct(o2, for1), { code: 'invalid_token' });
  // The same holder key certified for both stays separately bound.
  const key = await holder(), a = await w.certify(ALICE, o1, { key, client: CRM }), b = await w.certify(ALICE, o2, { key, client: ERP }).catch(error => error);
  assert.equal(b.code, 'delegation_revoked', 'a holder key never moves to another organization at home'); void a;
});

test('failed presentations are rate-limited per network whatever step failed, and per client once the signature verified', async () => {
  const w = await world(), o = w.org(ORG); o.add(ALICE); await w.warm(o, ALICE);
  const forgedMember = await w.certify(ALICE, o), nonMember = await w.certify(BOB, o), thief = await holder();
  // Per client: only failures whose signature a member key verified (a member's certificate with a stolen-key proof)
  // count against the certificate's client (review M4); a non-member's certificate never reaches the signature check.
  for (let i = 0; i < MEMBER_FAILURE_LIMITS.client; i++) await assert.rejects(w.token(o, nonMember, { network: `m${i}` }), { code: 'invalid_grant' });
  assert.ok((await w.token(o, await w.certify(ALICE, o), { network: 'fresh-0' })).access_token, 'unverified failures do not charge the client');
  for (let i = 0; i < MEMBER_FAILURE_LIMITS.client; i++) await assert.rejects(w.token(o, { ...forgedMember, key: thief }, { network: `n${i}` }), { code: 'invalid_grant' });
  await assert.rejects(w.token(o, await w.certify(ALICE, o), { network: 'fresh' }), { code: 'invalid_grant' }, 'the client is over its failure budget');
  assert.ok((await w.token(o, await w.certify(ALICE, o, { client: CRM }), { network: 'fresh', clientId: CRM.client_id })).access_token, 'another client is unaffected');
  // Per network: malformed presentations naming many clients exhaust the network.
  for (let i = 0; i < MEMBER_FAILURE_LIMITS.network; i++) await assert.rejects(w.token(o, { certificate: 'a.b.c', key: thief }, { network: 'bad-net', clientId: `https://x${i}.example/c` }), { code: 'invalid_grant' });
  await assert.rejects(w.token(o, await w.certify(ALICE, o, { client: CRM }), { network: 'bad-net', clientId: CRM.client_id }), { code: 'invalid_grant' });
  assert.ok((await w.token(o, await w.certify(ALICE, o, { client: CRM }), { network: 'good-net', clientId: CRM.client_id })).access_token);
  w.clock.advance(MEMBER_FAILURE_LIMITS.windowMs + 1); await w.warm(o, ALICE);
  assert.ok((await w.token(o, await w.certify(ALICE, o), { network: 'bad-net' })).access_token, 'budgets recover after the window');
});

test('seeded chaos: minting races membership end, aep resets, connection loss and home revocation without leaking authority', async () => {
  await forEachSeed(10, async random => {
    const w = await world({ seed: random.seed }), o = w.org(ORG), m = o.add(ALICE); await w.warm(o, ALICE);
    const certs = []; for (let i = 0; i < 3; i++) certs.push(await w.certify(ALICE, o));
    const minted = [], ops = [
      ...certs.map(c => async () => { const r = await w.token(o, c); minted.push({ r, c }); return r; }),
      async () => { m.state = 'ended'; m.generation++; return perform(o.engine, new EndMemberTokens({ actor: w.sys(o), input: { membership: m.id } })); },
      async () => { w.person(ALICE).state.aep = 1; return w.certify(ALICE, o).then(c => w.token(o, c)).catch(() => null); },
      async () => { o.connections.get(ERP.client_id).state = random.pick(['active', 'degraded', 'suspended']); },
    ];
    await concurrently(random.shuffle(ops));
    const now = Math.floor(w.clock.now() / 1000);
    for (const { r, c } of minted) {
      const p = parseMemberCertificate(c.certificate).payload; assert.ok(now + r.expires_in <= p.exp, `seed=${random.seed} token outlives certificate`);
      const used = await w.use(o, r.access_token, c.key).then(() => true, () => false);
      if (used) { assert.equal(m.state, 'live', `seed=${random.seed}`); assert.ok(p.aep >= m.aep, `seed=${random.seed} pre-reset token works`); assert.notEqual(o.connections.get(ERP.client_id).state, 'suspended', `seed=${random.seed}`); }
    }
  });
});

test('the profile codec rejects every deviation from the exact members and types', async () => {
  const w = await world(), o = w.org(ORG), good = await w.certify(ALICE, o), p = parseMemberCertificate(good.certificate);
  const key = await holder(), sign = (payload, header = p.header) => jws(header, payload, key.privateKey);
  const bad = [
    await sign({ ...p.payload, v: 2 }), await sign({ ...p.payload, bindle: 'key-delegation' }), await sign({ ...p.payload, aep: -1 }), await sign({ ...p.payload, purposes: [] }),
    await sign({ ...p.payload, purposes: [...Object.values(MEMBER_PURPOSES)].sort().reverse() }), await sign({ ...p.payload, client: { ...p.payload.client, extra: 1 } }),
    await sign({ ...p.payload, iat: p.payload.exp }), await sign({ ...p.payload, identity: 'https://elsewhere.example/identity/x' }), await sign({ ...p.payload, sub: 'not-a-uuid' }),
    await sign(p.payload, { ...p.header, extra: 1 }), await sign(p.payload, { ...p.header, alg: 'ES384' }), await sign(Object.fromEntries(MEMBER_CERTIFICATE_MEMBERS.filter(n => n !== 'aep').map(n => [n, p.payload[n]]))),
    good.certificate.replace(/\.[^.]+$/, '.' + base64url(textEncoder.encode('short'))), `${good.certificate}.x`, good.certificate + '=',
  ];
  for (const certificate of bad) assert.throws(() => parseMemberCertificate(certificate), { code: 'invalid_certificate' }, certificate.slice(0, 40));
});

// Security review regressions (organizations phase A, findings LM1/F1 and M4/F2).
test('review LM1 (F1): a forged certificate naming a member does the same request-path writes as a non-member', async () => {
  const w = await world(), o = w.org(ORG); o.add(ALICE);
  const genuine = await w.certify(ALICE, o), parsed = parseMemberCertificate(genuine.certificate);
  const forge = async sub => ({ certificate: await jws(parsed.header, { ...parsed.payload, sub, identity: identityOf(sub) }, (await holder()).privateKey), key: genuine.key });
  const writes = instrument(o), counts = {};
  for (const [name, sub, network] of [['nonMember', BOB, 'a'], ['unknown', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'b'], ['member', ALICE, 'c']]) { await assert.rejects(w.token(o, await forge(sub), { network }), { code: 'invalid_grant' }); counts[name] = writes(); }
  // F-07: each claimed principal with a missing cache row is enqueued once, member or not (the same writes).
  assert.equal(counts.nonMember, counts.member); assert.equal(counts.unknown, counts.member);
});
test('review M4 (F2): unsigned certificates naming an app do not lock its genuine members out', async () => {
  const w = await world(), o = w.org(ORG); o.add(ALICE); await w.warm(o, ALICE);
  const good = await w.certify(ALICE, o);
  assert.ok((await w.token(o, good, { network: 'alice-net' })).access_token);
  const parsed = parseMemberCertificate(good.certificate), attacker = await holder();
  for (let i = 0; i < 60; i++) {
    const cert = await jws(parsed.header, { ...parsed.payload, sub: BOB, identity: identityOf(BOB) }, attacker.privateKey);
    await assert.rejects(w.token(o, { certificate: cert, key: attacker }, { network: `attacker-${i % 3}` }), { code: 'invalid_grant' });
  }
  assert.ok((await w.token(o, await w.certify(ALICE, o), { network: 'alice-net' })).access_token, 'a genuine member on her own network is admitted');
});
