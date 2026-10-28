// ORG-4 over the durable Node runtime and the full HTTP router: a real person account issues a member certificate under
// its certification key, a real organization account (ORG-1 creation, ORG-2 initial membership) answers the jwt-bearer
// grant on /oauth/token with a DPoP-bound member-context token, `bindle_member` and no refresh token; holder-key status
// is public at the identity URI; every failure is the same 400 invalid_grant; and the flags default off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../apps/node/server.mjs';
import { IdentityService } from '../packages/identity/service.mjs';
import { identityBackupPort } from '../packages/runtime/identity-backup.mjs';
import { accountHandle } from '../packages/runtime/routes/shared.mjs';
import { stages as orgRoutes } from '../packages/runtime/routes/orgs.mjs';
import { stages as memberRoutes } from '../packages/runtime/routes/member-certificates.mjs';
import { personActor } from '../packages/orgs/authority.mjs';
import { MEMBER_PURPOSES, signMemberPop, parseMemberCertificate } from '../packages/identity/member-certificates.mjs';
import { JWT_BEARER } from '../packages/orgs/certificates.mjs';
import { federationEpoch } from '../packages/runtime/federation.mjs';
import { fakeHasher } from './helpers/identity-engine.mjs';
import { holder, dpop } from './helpers/member-certificates.mjs';

const ORIGIN = 'http://localhost:8788', PASSWORD = 'Member certificates runtime test password!';
const ERP = { client_id: 'https://erp.example/client.json', origin: 'https://erp.example' }, ACCESS = [MEMBER_PURPOSES.access];
const flagsOn = { ORGANIZATIONS_ENABLED: 'true', MEMBER_CERTIFICATES_ENABLED: 'true', DIRECTORY_ENABLED: 'true', FEDERATION_ENABLED: 'true' };

async function fixture(t, { flags = flagsOn } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'org-certs-runtime-'));
  const app = await createNodeServer({ directory, config: { ...flags, FEDERATION_CLIENTS: JSON.stringify([{ id: ERP.client_id, name: 'ERP', origin: ERP.origin, redirectUris: ['https://erp.example/callback'] }]), ORGANIZATION_PLANS: { check: async () => ({ paid: true, plan: 'organization-internal', source: 'test' }) } } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const RECOVERY_SIGNING_KEY = await readFile(join(directory, 'recovery-signing-key'), 'utf8'), repository = app.resources.repository, accounts = app.resources.accounts;
  const identity = new IdentityService({ repository, identityBackup: identityBackupPort({ config: { APP_ORIGIN: ORIGIN, RECOVERY_SIGNING_KEY }, accounts }), turnstile: { verify: async () => true }, rateLimiter: { check: async () => true }, webauthn: {}, passwordHasher: fakeHasher, config: { origin: ORIGIN, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  const base = { origin: ORIGIN, remoteIP: '127.0.0.1' };
  const signup = async () => { const pending = await identity.signup({ method: 'password', password: PASSWORD, ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'ok' }, base); const downloaded = await identity.downloadRecovery({ pendingToken: pending.pendingToken }, base); await identity.confirmRecovery({ pendingToken: pending.pendingToken, recoveryToken: downloaded.recoveryToken, downloadConfirmed: true }, base); return pending.account.id; };
  const env = { APP_ORIGIN: ORIGIN, RECOVERY_SIGNING_KEY, IDENTITY_REPOSITORY: repository, ACCOUNTS: accounts, ...flags };
  const owner = (id, method, path, input) => orgRoutes.owner({ request: new Request(ORIGIN + path, { method, headers: input ? { 'Content-Type': 'application/json' } : {}, ...input ? { body: JSON.stringify(input) } : {} }), env, path, id, object: accountHandle(env, id), actor: personActor({ owner: id, iss: ORIGIN, authTime: Date.now() }) });
  const memberOwner = (id, method, path, input) => memberRoutes.owner({ request: new Request(ORIGIN + path, { method, headers: input ? { 'Content-Type': 'application/json' } : {}, ...input ? { body: JSON.stringify(input) } : {} }), env, path, id, object: accountHandle(env, id), actor: personActor({ owner: id, iss: ORIGIN, authTime: Date.now() }) });
  return { app, repository, accounts, env, signup, owner, memberOwner };
}
async function setup(t, options) {
  const f = await fixture(t, options), alice = await f.signup();
  const created = await f.owner(alice, 'POST', '/api/orgs', { request: 'member-cert-runtime-0001', name: 'Acme Ltd', label: 'company' });
  assert.equal(created.status, 200); const org = (await created.json()).organization.id, aud = `${ORIGIN}/identity/${org}`;
  // The organization approved ERP (the integration connection record the existing flow writes).
  const { id } = await f.accounts.get(org).invoke({ method: 'appConnectionBinding', args: [org, ERP.client_id] });
  await f.accounts.get(org).metadata.put('resource/' + id, { id, owner: org, clientId: ERP.client_id, name: 'ERP', kind: 'app-connection', provider: 'app', transport: 'bindle', appOrigin: ERP.origin, status: 'active', state: 'active', generation: 1, connectedAt: Date.now() });
  // ...and holds a live grant to ERP in its federation shard (as the existing approval flow writes it).
  const shard = f.app.resources.federationShard(org), subject = `${ORIGIN}/entities/${org}`, epoch = await federationEpoch(await f.repository.get(org));
  await shard.metadata.transaction(tx => tx.set('federation/grant/grant-erp-000000000001', { id: 'grant-erp-000000000001', subject, clientId: ERP.client_id, fragment: 'https://3sln.me/artefacts/fragments/test/v1', digest: 'x', fields: [], resources: {}, methods: {}, active: true, epoch }));
  const invoke = async (account, method, args) => { const result = await f.accounts.get(account).invoke({ method, args }); if (result?.$fault) throw Object.assign(new Error(result.$fault.message), result.$fault); return result; };
  const certify = async (sub, key) => {
    await invoke(sub, 'memberCertificateConsent', [sub, { client: ERP, input: { aud, purposes: ACCESS } }]);
    const proof = await signMemberPop({ privateKey: key.privateKey, aud, clientId: ERP.client_id, iat: Math.floor(Date.now() / 1000), issuer: ORIGIN, jkt: key.jkt, subject: sub });
    return invoke(sub, 'memberCertificateIssue', [sub, { actor: { kind: 'app', client: ERP }, input: { aud, purposes: ACCESS, delegate: key.jwk, proof } }]);
  };
  const tokenRequest = async (certificate, key, { clientId = ERP.client_id, extra = {} } = {}) => f.app.fetch(new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: await dpop(key, { htu: `${ORIGIN}/oauth/token`, nowMs: Date.now() }), Origin: ERP.origin }, body: new URLSearchParams({ grant_type: JWT_BEARER, assertion: certificate, client_id: clientId, ...extra }) }));
  return { ...f, alice, org, aud, invoke, certify, tokenRequest, shard, subject };
}

test('runtime: jwt-bearer member grant over the router, bindle_member, no refresh token, uniform failures', async t => {
  const s = await setup(t), key = await holder(), issued = await s.certify(s.alice, key);
  const payload = parseMemberCertificate(issued.certificate, { allowLoopback: true }).payload;
  assert.equal(payload.iss, ORIGIN); assert.equal(payload.aud, s.aud); assert.equal(payload.exp - payload.iat, 660);
  // F-07: the same-host issuance hinted the organization, which warmed Alice's certification key in the background
  // (fire-and-forget, so give it a moment); the first use then succeeds.
  await new Promise(resolve => setTimeout(resolve, 200));
  const response = await s.tokenRequest(issued.certificate, key);
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.token_type, 'DPoP'); assert.equal(body.refresh_token, undefined); assert.ok(body.expires_in <= 660);
  assert.equal(body.bindle_member.entity, s.aud); assert.match(body.bindle_member.id, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ERP.origin); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  // The token is a federation access token in the organization's shard: DPoP-bound to the holder key, carrying ORG-3's
  // `token.member` with complete provenance, and accepted by ORG-3's live tokenRecord hook.
  assert.ok(body.access_token.startsWith(`${s.org}.`), 'routed to the organization shard');
  const rows = await s.shard.metadata.transaction(tx => tx.list('federation/token/')), record = rows.map(r => r.value).find(r => r.member);
  assert.equal(record.jkt, key.jkt); assert.equal(record.subject, s.subject); assert.equal(record.clientId, ERP.client_id); assert.equal(record.familyId, undefined, 'no refresh family');
  assert.ok(record.expiresAt <= payload.exp * 1000); assert.equal(record.member.membership_id, body.bindle_member.id); assert.deepEqual(record.member.principal, { iss: ORIGIN, sub: s.alice });
  const signing = await s.invoke(s.alice, 'memberCertificateKeys', [s.alice]);
  assert.equal(record.member.addedUnder.kid, signing.signing.kid); assert.equal(record.member.addedUnder.certificationKid, JSON.parse(Buffer.from(issued.certificate.split('.')[0], 'base64url')).kid); assert.equal(record.member.addedUnder.authentication, 'member-certificate');
  const live = await s.shard.metadata.transaction(tx => s.shard.service.tokenRecord(tx, record));
  assert.equal(live.token.member.membership_id, body.bindle_member.id);
  // Uniform failures: a replayed proof is impossible to send twice here, so: wrong client_id, a confidential-client
  // parameter, a forged signature, and a different key; all exactly 400 {"error":"invalid_grant"}.
  const forged = issued.certificate.replace(/\.[^.]+$/, '.' + 'A'.repeat(86));
  const failures = [await s.tokenRequest(issued.certificate, key, { clientId: 'https://other.example/client.json' }), await s.tokenRequest(issued.certificate, key, { extra: { client_assertion: 'x' } }), await s.tokenRequest(forged, key), await s.tokenRequest(issued.certificate, await holder())];
  for (const failure of failures) { assert.equal(failure.status, 400); assert.deepEqual(await failure.json(), { error: 'invalid_grant' }); }
  // Public status at the identity URI, and the member's revocation.
  const status = async () => s.app.fetch(new Request(`${ORIGIN}/identity/${s.alice}/delegations/${key.jkt}`));
  let answer = await status(); assert.equal(answer.status, 200); assert.deepEqual(await answer.json(), { status: 'active' }); assert.equal(answer.headers.get('Cache-Control'), 'public, max-age=60');
  const revoked = await s.memberOwner(s.alice, 'POST', '/api/member-certificates/revoke', { jkt: key.jkt }); assert.deepEqual(await revoked.json(), { revoked: 1 });
  answer = await status(); assert.equal(answer.status, 200); assert.equal((await answer.json()).status, 'revoked');
  const listed = await (await s.memberOwner(s.alice, 'GET', '/api/member-certificates')).json(); assert.equal(listed.consents[0].aud, s.aud); assert.equal(listed.consents[0].keys[0].state, 'revoked');
  // The organization's lifetime setting, through the owner route (Alice is its initial admin).
  const settings = await s.memberOwner(s.alice, 'GET', `/api/member-certificates/settings/${s.org}`); assert.deepEqual(await settings.json(), { certificateSeconds: 660 });
  const unknown = await s.app.fetch(new Request(`${ORIGIN}/identity/${s.alice}/delegations/${(await holder()).jkt}`)); assert.equal(unknown.status, 404);
  // R4-H1: the certification key is published in the identity document and never in the recovery keychain.
  // (Recovery file v3 holds no keys at all; the certification key is also never an identity signing key.)
  const signingKeys = await s.app.resources.accounts.get(s.alice).identityKeyHistory(s.alice, { purpose: 'signing' }), kid = JSON.parse(Buffer.from(issued.certificate.split('.')[0], 'base64url')).kid;
  assert.ok(!signingKeys.some(k => k.kid === kid));
  const published = await s.invoke(s.alice, 'memberCertificateKeys', [s.alice]);
  assert.equal(published.identity, `${ORIGIN}/identity/${s.alice}`); assert.ok(published.keys.some(k => k.kid === kid && k.state === 'active'), 'the local key read lists the certification key');
});

test('runtime: default off — no consent or issuance, and the jwt-bearer grant is not answered as a member grant', async t => {
  const s = await setup(t, { flags: { ORGANIZATIONS_ENABLED: 'true', DIRECTORY_ENABLED: 'true' } }), key = await holder();
  await assert.rejects(s.certify(s.alice, key), { code: 'not_found' });
  const listed = await s.invoke(s.alice, 'memberCertificatesList', [s.alice]); assert.deepEqual(listed.consents, []);
});

// Integration gap 3: member-token RPC rides the DPoP path, mounted under the organization/member flags without the
// device grant (DEVICE_AUTHORIZATION_ENABLED is off in this fixture); device-grant behaviour is unchanged.
test('runtime: member-token DPoP RPC is mounted under the org/member flags without the device grant', async t => {
  const s = await setup(t), key = await holder(), issued = await s.certify(s.alice, key);
  await s.tokenRequest(issued.certificate, key); await new Promise(resolve => setTimeout(resolve, 400));
  const minted = await (await s.tokenRequest((await s.certify(s.alice, key)).certificate, key)).json();
  assert.equal(minted.token_type, 'DPoP', JSON.stringify(minted));
  const envelope = () => ({ version: '0', tx: crypto.randomUUID(), resource: '@profile', contract: 'https://3sln.me/artefacts/contracts/profile/v1', method: 'read', args: {} });
  const rpc = async (token, proofKey = key, extra = {}) => s.app.fetch(new Request(`${ORIGIN}/bindle/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `DPoP ${token}`, DPoP: await dpop(proofKey, { htu: `${ORIGIN}/bindle/rpc`, nowMs: Date.now(), ath: token, ...extra }) }, body: JSON.stringify(envelope()) }));
  // Authenticated by the DPoP path, then refused by the shard's live §6.2 intersection (this grant has no @profile
  // method); without the mount the router answers 401 "Bearer token required." instead.
  const ok = await rpc(minted.access_token), body = await ok.json();
  assert.equal(ok.status, 403, JSON.stringify(body)); assert.equal(body.error, 'forbidden');
  // The proof must be by the certified key, and a forged token is refused as on the device path.
  const wrongKey = await rpc(minted.access_token, await holder()); assert.equal(wrongKey.status, 401);
  const forged = await rpc(`${s.org}.${'A'.repeat(43)}`); assert.equal(forged.status, 401);
});
test('runtime: member-token DPoP RPC is not mounted with the member flags off', async t => {
  const { MEMBER_CERTIFICATES_ENABLED, ...flags } = flagsOn; void MEMBER_CERTIFICATES_ENABLED;
  const f = await fixture(t, { flags }), key = await holder(), token = `${crypto.randomUUID()}.${'A'.repeat(43)}`;
  const response = await f.app.fetch(new Request(`${ORIGIN}/bindle/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `DPoP ${token}`, DPoP: await dpop(key, { htu: `${ORIGIN}/bindle/rpc`, nowMs: Date.now(), ath: token }) }, body: JSON.stringify({ version: '0', tx: crypto.randomUUID(), resource: '@profile', contract: 'x', method: 'read', args: {} }) }));
  const body = await response.json(); assert.equal(response.status, 401); assert.equal(body.message, 'Bearer token required.', 'the DPoP provider path is not reached');
});

test('runtime ORG-6a review: inspection names the local organization and the app; a stale proof leaves no consent (M1, M2)', async t => {
  const s = await setup(t), key = await holder(), env = { ...s.env, LOCAL_DEVELOPMENT: 'true', FEDERATION_AUTHORITY: { clients: [{ id: ERP.client_id, name: 'ERP', origin: ERP.origin, redirectUris: ['https://erp.example/callback'] }] } }, redirect = 'https://erp.example/callback', path = '/api/member-certificates/acquire';
  const query = aud => '?' + new URLSearchParams({ client_id: ERP.client_id, redirect_uri: redirect, aud });
  const inspect = async aud => { const r = await memberRoutes.owner({ request: new Request(ORIGIN + path + query(aud)), env, path, id: s.alice, object: accountHandle(s.env, s.alice) }); assert.equal(r.status, 200); return r.json(); };
  const view = await inspect(s.aud);
  assert.deepEqual(view.organization, { name: 'Acme Ltd', handle: view.organization.handle, host: new URL(ORIGIN).host, verified: true, source: 'local' });
  assert.deepEqual(view.app, { name: 'ERP', claimedName: null, reviewed: true }); assert.deepEqual(view.client, ERP);
  const unknown = await inspect(`${ORIGIN}/identity/99999999-9999-4999-8999-999999999999`);
  assert.equal(unknown.organization.verified, false); assert.equal(unknown.organization.name, null);
  const post = async proof => memberRoutes.owner({ request: new Request(ORIGIN + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ client_id: ERP.client_id, redirect_uri: redirect, aud: s.aud, consent: true, delegate: key.jwk, proof }) }), env, path, id: s.alice, object: accountHandle(s.env, s.alice) });
  const sign = iat => signMemberPop({ privateKey: key.privateKey, aud: s.aud, clientId: ERP.client_id, iat, issuer: ORIGIN, jkt: key.jkt, subject: s.alice });
  await assert.rejects(post(await sign(Math.floor(Date.now() / 1000) - 121)), { code: 'invalid_request' });
  assert.deepEqual((await s.invoke(s.alice, 'memberCertificatesList', [s.alice])).consents, []);
  const ok = await post(await sign(Math.floor(Date.now() / 1000))); assert.equal(ok.status, 200); assert.ok((await ok.json()).certificate);
  const [consent] = (await s.invoke(s.alice, 'memberCertificatesList', [s.alice])).consents;
  assert.equal(consent.state, 'active'); assert.deepEqual(consent.keys.map(k => k.jkt), [key.jkt]);
});
