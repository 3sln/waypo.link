// Wargame F-06 (2026-10-23): member-context federation tokens are capped per (membership, client) with eviction of
// that membership's oldest, counted apart from the organization's app tokens, and bounded organization-wide by a
// capacity sized to the plan's member count. Before the fix, issueMemberAccess shared the shard's 'token' bound (256)
// with app sessions, so one member could mint 256 tokens and lock every other member (and the org's apps) out.
// Engine level against issueMemberAccess; the runtime port of the wargame repro follows (FLOOD controls its size;
// FLOOD=0 is the control run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FederationService, MemoryFederationStore } from '../packages/federation/index.mjs';
import { issueMemberAccess, MEMBER_ACCESS_PER_CLIENT, MEMBER_ACCESS_PER_MEMBERSHIP, memberAccessCapacity } from '../packages/federation/member-access.mjs';
import { issueAppAccess } from '../packages/federation/app-sessions.mjs';
import { forEachSeed } from './helpers/chaos.mjs';

const ISSUER = 'https://provider.example', ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', SUBJECT = `${ISSUER}/entities/${ORG}`, ERP = 'https://erp.example/client.json', CRM = 'https://crm.example/client.json', HR = 'https://hr.example/client.json';
const uuid = n => { const h = n.toString(16).padStart(12, '0'); return `0000${h.slice(0, 4)}-0000-4000-8000-${h}`; };
function shard() {
  let now = 1_800_000_000_000, n = 0;
  const service = new FederationService({ issuer: ISSUER, crypto: webcrypto, clock: () => now, store: new MemoryFederationStore(), clients: [{ id: ERP, name: 'ERP', origin: 'https://erp.example', redirectUris: ['https://erp.example/cb'] }, { id: CRM, name: 'CRM', origin: 'https://crm.example', redirectUris: ['https://crm.example/cb'] }, { id: HR, name: 'HR', origin: 'https://hr.example', redirectUris: ['https://hr.example/cb'] }] });
  service.routingKey = ORG; service.random = () => `${ORG}.${String(++n).padStart(43, 'a')}`;
  const ready = service.store.transaction(async tx => { for (const [i, clientId] of [ERP, CRM, HR].entries()) await tx.set(`federation/grant/grant-${i}-00000000000001`, { id: `grant-${i}-00000000000001`, subject: SUBJECT, clientId, active: true, epoch: 'e1', fields: [], resources: {} }); });
  const mint = (sub, { clientId = ERP, capacity, ttl = 600000 } = {}) => issueMemberAccess(service, { clientId, jkt: 'j'.repeat(43), expiresAt: now + ttl, epoch: 'e1', connection: { id: 'c1', generation: 1 }, member: { principal: { iss: ISSUER, sub }, membership_id: 'm' + sub.replaceAll('-', '').slice(-20), generation: 1, aep: 0, client: clientId }, ...capacity === undefined ? {} : { capacity } });
  const tokens = () => service.store.transaction(async tx => (await tx.list('federation/token/')).map(r => r.value));
  return { service, ready, mint, tokens, advance: ms => { now += ms; }, now: () => now };
}

test('F-06: one member flooding member tokens keeps at most the per-client cap and never locks other members out', async () => {
  const s = shard(); await s.ready; const flooder = uuid(1);
  for (let i = 0; i < 300; i++) assert.equal((await s.mint(flooder)).token_type, 'DPoP', 'the flooder\'s own newest token is always issued (its oldest is evicted)');
  const live = (await s.tokens()).filter(t => t.member?.principal.sub === flooder);
  assert.equal(live.length, MEMBER_ACCESS_PER_CLIENT, 'live tokens of one membership and client stay at the cap');
  for (let i = 2; i < 40; i++) assert.equal((await s.mint(uuid(i))).token_type, 'DPoP', 'every other member still gets a token');
  // The cap is per client: the same member on a second app keeps its own allowance.
  for (let i = 0; i < 12; i++) await s.mint(flooder, { clientId: CRM });
  assert.equal((await s.tokens()).filter(t => t.member?.principal.sub === flooder).length, 2 * MEMBER_ACCESS_PER_CLIENT);
});

test('F-06: the organization-wide bound is the plan capacity, refused uniformly; expired tokens free it', async () => {
  const s = shard(); await s.ready;
  for (let i = 1; i <= 5; i++) await s.mint(uuid(i), { capacity: 5 });
  await assert.rejects(s.mint(uuid(6), { capacity: 5 }), { code: 'invalid_grant' });
  // At the bound nobody adds a token (the bound is hard); a membership at its per-client cap still rotates its own.
  await assert.rejects(s.mint(uuid(1), { capacity: 5 }), { code: 'invalid_grant' });
  s.advance(600001); assert.equal((await s.mint(uuid(6), { capacity: 5 })).token_type, 'DPoP', 'expired member tokens are pruned and stop counting');
  assert.equal(memberAccessCapacity(5000), 5000 * MEMBER_ACCESS_PER_MEMBERSHIP); assert.equal(memberAccessCapacity(10), 256); assert.equal(memberAccessCapacity(undefined), 256);
});

// Review follow-up 5: a per-membership total across clients, so honest multi-app use fits and one member holds at most
// MEMBER_ACCESS_PER_MEMBERSHIP of the organization-wide bound; a refusal still commits the expired-row pruning.
test('follow-up 5: one membership holds at most the per-membership total across all its clients', async () => {
  const s = shard(); await s.ready; const member = uuid(1);
  for (const clientId of [ERP, CRM, HR]) for (let i = 0; i < MEMBER_ACCESS_PER_CLIENT; i++) assert.equal((await s.mint(member, { clientId })).token_type, 'DPoP');
  const mine = (await s.tokens()).filter(t => t.member?.principal.sub === member);
  assert.equal(mine.length, MEMBER_ACCESS_PER_MEMBERSHIP, 'the membership\'s oldest tokens are evicted beyond the total');
  assert.equal(mine.filter(t => t.clientId === HR).length, MEMBER_ACCESS_PER_CLIENT, 'the newest client keeps its full allowance');
  assert.ok(MEMBER_ACCESS_PER_MEMBERSHIP < MEMBER_ACCESS_PER_CLIENT * 3);
});
test('follow-up 5: a refused mint still prunes expired member tokens', async () => {
  const s = shard(); await s.ready;
  for (let i = 1; i <= 2; i++) await s.mint(uuid(i), { capacity: 6, ttl: 1000 });
  for (let i = 3; i <= 6; i++) await s.mint(uuid(i), { capacity: 6 });
  s.advance(2000); assert.equal((await s.tokens()).length, 6);
  await assert.rejects(s.mint(uuid(8), { capacity: 4 }), { code: 'invalid_grant' });
  assert.equal((await s.tokens()).length, 4, 'the expired rows were deleted even though the request was refused');
});
test('F-06: member tokens do not count against the organization\'s app-token bound', async () => {
  const s = shard(); await s.ready;
  for (let i = 1; i <= 40; i++) for (let k = 0; k < MEMBER_ACCESS_PER_CLIENT; k++) await s.mint(uuid(i), { capacity: 4096 });
  assert.equal((await s.tokens()).length, 320);
  // 320 live member tokens > the 256 app bound: an app family can still get its access token.
  const family = { familyId: 'family-0000000000000001', subject: SUBJECT, clientId: ERP, epoch: 'e1', expiresAt: s.now() + 86400000, access: 'dpop', jkt: 'k'.repeat(43), status: 'active' };
  s.service.liveGrantIds = async () => ['grant-0-00000000000001'];
  const issued = await s.service.store.transaction(tx => issueAppAccess(s.service, tx, family));
  assert.equal(issued.token_type, 'DPoP');
});

test('F-06 chaos: under seeded member/client/time mixes, no membership+client exceeds the cap and the bound holds', () => forEachSeed(8, async random => {
  const s = shard(); await s.ready; const capacity = 24 + random.int(16);
  for (let step = 0; step < 200; step++) {
    if (random.chance(0.1)) s.advance(random.int(400000));
    try { await s.mint(uuid(1 + random.int(6)), { clientId: random.pick([ERP, CRM, HR]), capacity, ttl: 60000 + random.int(600000) }); } catch (error) { assert.equal(error.code, 'invalid_grant'); }
    const live = (await s.tokens()).filter(t => t.member && t.expiresAt > s.now()), per = new Map();
    for (const t of live) { const k = t.member.membership_id + ' ' + t.clientId; per.set(k, (per.get(k) ?? 0) + 1); }
    assert.ok([...per.values()].every(n => n <= MEMBER_ACCESS_PER_CLIENT), 'per-client cap');
    const perMember = new Map(); for (const t of live) perMember.set(t.member.membership_id, (perMember.get(t.member.membership_id) ?? 0) + 1);
    assert.ok([...perMember.values()].every(n => n <= MEMBER_ACCESS_PER_MEMBERSHIP), 'per-membership total');
    assert.ok(live.length <= capacity, 'organization-wide bound');
  }
}));

// ---- runtime: the wargame repro over the durable Node runtime and the full HTTP router ----------------------------
const { createNodeServer } = await import('../apps/node/server.mjs');
const { IdentityService } = await import('../packages/identity/service.mjs');
const { identityBackupPort } = await import('../packages/runtime/identity-backup.mjs');
const { accountHandle } = await import('../packages/runtime/routes/shared.mjs');
const { stages: orgRoutes } = await import('../packages/runtime/routes/orgs.mjs');
const { personActor } = await import('../packages/orgs/authority.mjs');
const { MEMBER_PURPOSES, signMemberPop } = await import('../packages/identity/member-certificates.mjs');
const { JWT_BEARER, cachedIssuerKeys } = await import('../packages/orgs/certificates.mjs');
const { federationEpoch } = await import('../packages/runtime/federation.mjs');
const { fakeHasher } = await import('./helpers/identity-engine.mjs');
const { holder, dpop } = await import('./helpers/member-certificates.mjs');
const ORIGIN = 'http://localhost:8788', PASSWORD = 'Member token cap runtime test password!';
const APP = { client_id: 'https://erp.example/client.json', origin: 'https://erp.example' }, ACCESS = [MEMBER_PURPOSES.access];
const flagsOn = { ORGANIZATIONS_ENABLED: 'true', MEMBER_CERTIFICATES_ENABLED: 'true', DIRECTORY_ENABLED: 'true', FEDERATION_ENABLED: 'true' };

test('F-06 runtime: one member flooding the token endpoint keeps the per-client cap and an honest member still gets a token', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'org-token-cap-'));
  const app = await createNodeServer({ directory, config: { ...flagsOn, FEDERATION_CLIENTS: JSON.stringify([{ id: APP.client_id, name: 'ERP', origin: APP.origin, redirectUris: ['https://erp.example/callback'] }]), ORGANIZATION_PLANS: { check: async () => ({ paid: true, plan: 'organization-internal', source: 'test' }) } } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const RECOVERY_SIGNING_KEY = await readFile(join(directory, 'recovery-signing-key'), 'utf8'), repository = app.resources.repository, accounts = app.resources.accounts;
  const identity = new IdentityService({ repository, identityBackup: identityBackupPort({ config: { APP_ORIGIN: ORIGIN, RECOVERY_SIGNING_KEY }, accounts }), turnstile: { verify: async () => true }, rateLimiter: { check: async () => true }, webauthn: {}, passwordHasher: fakeHasher, config: { origin: ORIGIN, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  const base = { origin: ORIGIN, remoteIP: '127.0.0.1' };
  const signup = async () => { const pending = await identity.signup({ method: 'password', password: PASSWORD, ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'ok' }, base); const downloaded = await identity.downloadRecovery({ pendingToken: pending.pendingToken }, base); await identity.confirmRecovery({ pendingToken: pending.pendingToken, recoveryToken: downloaded.recoveryToken, downloadConfirmed: true }, base); return pending.account.id; };
  const env = { APP_ORIGIN: ORIGIN, RECOVERY_SIGNING_KEY, IDENTITY_REPOSITORY: repository, ACCOUNTS: accounts, ...flagsOn };
  const owner = (id, method, path, input) => orgRoutes.owner({ request: new Request(ORIGIN + path, { method, headers: input ? { 'Content-Type': 'application/json' } : {}, ...input ? { body: JSON.stringify(input) } : {} }), env, path, id, object: accountHandle(env, id), actor: personActor({ owner: id, iss: ORIGIN, authTime: Date.now() }) });
  const alice = await signup();
  const created = await owner(alice, 'POST', '/api/orgs', { request: 'member-token-cap-0001', name: 'Acme Ltd', label: 'company' });
  assert.equal(created.status, 200); const org = (await created.json()).organization.id, aud = `${ORIGIN}/identity/${org}`;
  const { id } = await accounts.get(org).invoke({ method: 'appConnectionBinding', args: [org, APP.client_id] });
  await accounts.get(org).metadata.put('resource/' + id, { id, owner: org, clientId: APP.client_id, name: 'ERP', kind: 'app-connection', provider: 'app', transport: 'bindle', appOrigin: APP.origin, status: 'active', state: 'active', generation: 1, connectedAt: Date.now() });
  const shardStore = app.resources.federationShard(org), subject = `${ORIGIN}/entities/${org}`, epoch = await federationEpoch(await repository.get(org));
  await shardStore.metadata.transaction(tx => tx.set('federation/grant/grant-erp-000000000001', { id: 'grant-erp-000000000001', subject, clientId: APP.client_id, fragment: 'https://3sln.me/artefacts/fragments/test/v1', digest: 'x', fields: [], resources: {}, methods: {}, active: true, epoch }));
  const invoke = async (account, method, args) => { const result = await accounts.get(account).invoke({ method, args }); if (result?.$fault) throw Object.assign(new Error(result.$fault.message), result.$fault); return result; };
  const certify = async (sub, key) => {
    await invoke(sub, 'memberCertificateConsent', [sub, { client: APP, input: { aud, purposes: ACCESS } }]);
    const proof = await signMemberPop({ privateKey: key.privateKey, aud, clientId: APP.client_id, iat: Math.floor(Date.now() / 1000), issuer: ORIGIN, jkt: key.jkt, subject: sub });
    return invoke(sub, 'memberCertificateIssue', [sub, { actor: { kind: 'app', client: APP }, input: { aud, purposes: ACCESS, delegate: key.jwk, proof } }]);
  };
  const warm = sub => cachedIssuerKeys({ metadata: accounts.get(org).metadata, issuer: ORIGIN, read: s => invoke(s, 'memberCertificateKeys', [s]) }).refresh({ issuer: ORIGIN, subject: sub });
  const ip = i => `10.${(i >> 8) & 255}.${i & 255}.7`;
  const mint = async (certificate, k, i) => app.fetch(new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip(i), DPoP: await dpop(k, { htu: `${ORIGIN}/oauth/token`, nowMs: Date.now() }), Origin: APP.origin }, body: new URLSearchParams({ grant_type: JWT_BEARER, assertion: certificate, client_id: APP.client_id }) }));
  const key = await holder(), issued = await certify(alice, key); await warm(alice);
  const flood = Number(process.env.FLOOD ?? 40); let ok = 0;
  for (let i = 0; i < flood; i++) { const r = await mint(issued.certificate, key, i); if (r.status === 200) ok++; }
  const live = await shardStore.metadata.transaction(async tx => (await tx.list('federation/token/')).map(r => r.value).filter(v => v.member?.principal.sub === alice && v.expiresAt > Date.now()));
  assert.ok(live.length <= MEMBER_ACCESS_PER_CLIENT, `one member holds ${live.length} live member tokens after ${ok} mints`);
  if (flood > MEMBER_ACCESS_PER_CLIENT) assert.equal(ok, flood, 'the flooder\'s own requests succeed by evicting its oldest, never by refusing others');
  const bob = await signup();
  const invite = await (await owner(alice, 'POST', `/api/orgs/${org}/invitations`, { invitee: { iss: ORIGIN, sub: bob }, grants: [] })).json();
  const joined = await owner(bob, 'POST', `/api/orgs/${org}/accept`, { invitation: invite.meta ?? invite.invitation }); assert.equal(joined.status, 200, await joined.clone().text());
  const bobKey = await holder(), bobCert = await certify(bob, bobKey); await warm(bob);
  const r = await mint(bobCert.certificate, bobKey, 200001); assert.equal(r.status, 200, 'an honest member is not locked out of member tokens');
});
