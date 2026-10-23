// ORG-4 foreign-member conformance against a TEST-ONLY second issuer (tests/helpers/second-issuer.mjs): self-consistency
// evidence, not interoperability (design §13.3, R2-M6). Foreign issuers are verified only through the ORG-7 directory
// (cache-only on the request path, background refresh), only with ORG_FOREIGN_MEMBERS_ENABLED and an explicit issuer
// allowlist (empty by default), with no request-triggered fetch, and with directory key resets as authority resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteMetadata } from '../apps/node/resources.mjs';
import { MemoryMessagingStore } from '../packages/core/records.mjs';
import { createAppEngine, perform } from '../packages/app/engine.mjs';
import { memoryAudit } from '../packages/app/providers.mjs';
import { IdentityDirectory } from '../packages/federation/directory.mjs';
import { MemberContextService, memberContextProvider, directoryIssuerKeys, cachedIssuerKeys, memberPrincipalKey, MemberToken, MemberKeyRefresh } from '../packages/orgs/certificates.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { holder, dpop } from './helpers/member-certificates.mjs';
import { secondIssuer } from './helpers/second-issuer.mjs';

const HOST = 'https://3sln.example', ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', AUD = `${HOST}/identity/${ORG}`, TOKEN_URL = `${HOST}/oauth/token`;
const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', DAVE = 'dddddddd-0000-4000-8000-000000000000';
const ERP = { client_id: 'https://erp.example/client.json', origin: 'https://erp.example' };

async function world({ foreign = false, allowlist = [] } = {}) {
  const clock = fakeClock(1800000000000), second = await secondIssuer({ clock: clock.now });
  const directory = new IdentityDirectory({ store: new MemoryMessagingStore(), fetch: second.fetch, enabled: true, issuers: [second.origin], clock: clock.now });
  const metadata = new SqliteMetadata(':memory:'), memberships = new Map(), flags = { foreign }, holds = [], lastProvenance = {};
  const members = {
    async roster() { return [...memberships.values()].filter(m => m.state === 'live').map(m => ({ ...m.principal })); },
    async lookup(principal) { const m = memberships.get(memberPrincipalKey(principal)); return m?.state === 'live' ? { id: m.id, generation: m.generation, aep: m.aep } : null; },
    async observe(principal, { aep, reset, addedUnder }) { lastProvenance.value = addedUnder; const m = memberships.get(memberPrincipalKey(principal)); if (!m) return null; if (aep < m.aep) throw Object.assign(new Error('stale'), { code: 'authority_epoch_stale' }); if (aep > m.aep || reset) { m.aep = aep; holds.push({ aep, reset }); } return m; },
    async context(principal, { generation }) { const m = memberships.get(memberPrincipalKey(principal)); return { membership_id: m.id, generation }; },
  };
  const service = new MemberContextService({ metadata, organization: { id: ORG, identity: AUD }, issuer: HOST, members, local: cachedIssuerKeys({ metadata, issuer: HOST, read: async () => null, clock: clock.now }), foreign: directoryIssuerKeys(directory), connections: { check: async ({ clientId, origin }) => clientId === ERP.client_id && origin === ERP.origin }, flags: { organizations: () => true, foreign: () => flags.foreign }, foreignIssuers: allowlist.length ? allowlist : [], clock: clock.now });
  const engine = createAppEngine({ providers: { clock: { now: clock.now }, random: { uuid: () => crypto.randomUUID() }, audit: memoryAudit({ clock: { now: clock.now } }), memberContext: memberContextProvider(service) } });
  const add = sub => { const m = { id: crypto.randomUUID().replaceAll('-', ''), principal: { iss: second.origin, sub }, state: 'live', generation: 1, aep: 0 }; memberships.set(memberPrincipalKey({ iss: second.origin, sub }), m); return m; };
  const token = async (certificate, key) => perform(engine, new MemberToken({ actor: { kind: 'system', owner: ORG }, input: { assertion: certificate, clientId: ERP.client_id, dpop: await dpop(key, { htu: TOKEN_URL, nowMs: clock.now() }), htu: TOKEN_URL, network: 'n' } }));
  const refresh = () => perform(engine, new MemberKeyRefresh({ actor: { kind: 'system', owner: ORG } }));
  return { clock, second, directory, flags, add, token, refresh, holds, service, lastProvenance };
}

test('foreign issuers are refused by default: flag off or an empty allowlist, with no fetch and no refresh', async () => {
  for (const options of [{}, { foreign: true }, { foreign: false, allowlist: ['https://second.example'] }]) {
    const w = await world(options), key = await holder(); w.add(CAROL);
    const certificate = await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key });
    await assert.rejects(w.token(certificate, key), { code: 'invalid_grant', status: 400 });
    w.clock.advance(10000); await w.refresh();
    assert.deepEqual(w.second.calls, [], JSON.stringify(options));
  }
});

test('an allowlisted foreign member: a miss fails uniformly with no request-path fetch, the background refresh warms it, then the token form works', async () => {
  const w = await world({ foreign: true, allowlist: ['https://second.example'] }), key = await holder(), m = w.add(CAROL);
  const certificate = await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key });
  await assert.rejects(w.token(certificate, key), { code: 'invalid_grant' });
  assert.deepEqual(w.second.calls, [], 'no fetch on the request path (R2-H1)');
  w.clock.advance(10000); assert.equal((await w.refresh()).done, 1);
  assert.deepEqual(w.second.calls.map(u => new URL(u).pathname), ['/.well-known/bindle/manifest.json', '/directory', `/people/${CAROL}/identity.json`]);
  const calls = w.second.calls.length, response = await w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key }), key);
  assert.equal(response.token_type, 'DPoP'); assert.deepEqual(response.bindle_member, { entity: AUD, id: m.id }); assert.equal(w.second.calls.length, calls);
  const sig = (await w.second.person(CAROL)).keys.find(k => k.use === 'sig' && k.state === 'active');
  assert.equal(w.lastProvenance.value.kid, sig.kid); assert.deepEqual(w.lastProvenance.value.publicKey, sig.jwk); assert.equal(w.lastProvenance.value.authentication, 'member-certificate');
  // A non-member naming the same issuer never schedules a fetch.
  const other = await holder(); await w.second.person(DAVE);
  await assert.rejects(w.token(await w.second.certify({ sub: DAVE, aud: AUD, client: ERP, holder: other }), other), { code: 'invalid_grant' });
  w.clock.advance(10000); assert.equal((await w.refresh()).done, 0); assert.equal(w.second.calls.length, calls);
  // The kill switch takes effect at once.
  w.flags.foreign = false; await assert.rejects(w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key }), key), { code: 'invalid_grant' });
});

test('foreign verification: wrong certification key, retired keys, signing-key certificates, lower aep and key resets', async () => {
  const w = await world({ foreign: true, allowlist: ['https://second.example'] }), key = await holder(); w.add(CAROL);
  await w.second.person(CAROL); w.clock.advance(1000);
  await assert.rejects(w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key }), key)); w.clock.advance(10000); await w.refresh();
  const p = await w.second.person(CAROL), sig = p.keys.find(k => k.use === 'sig');
  // Signed by the identity signing key (R4-H1), or naming the signing kid: refused.
  await assert.rejects(w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, kid: sig.kid, signWith: sig }), key), { code: 'invalid_grant' });
  assert.ok((await w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 2 }), key)).access_token);
  await assert.rejects(w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 1 }), key), { code: 'invalid_grant' }, 'lower aep (R2-M1)');
  // Certification-key rotation: certificates under the retired key die once the cache refreshes.
  const old = await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 2 });
  await w.second.rotateCertification(CAROL); w.clock.advance(301000);
  await assert.rejects(w.token(old, key)); w.clock.advance(10000); await w.refresh();
  await assert.rejects(w.token(old, key), { code: 'invalid_grant' }, 'retired certification key');
  assert.ok((await w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 2 }), key)).access_token);
  // A signing-key reset without continuity is an authority reset at this organization (spec §3a.4, §5.2a).
  const before = w.holds.length; await w.second.resetSigning(CAROL); w.clock.advance(301000);
  await assert.rejects(w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 2 }), key)); w.clock.advance(10000); await w.refresh();
  assert.ok((await w.token(await w.second.certify({ sub: CAROL, aud: AUD, client: ERP, holder: key, aep: 2 }), key)).access_token);
  assert.deepEqual(w.holds.slice(before), [{ aep: 2, reset: true }]);
});
