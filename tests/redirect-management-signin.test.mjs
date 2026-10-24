// Redirect management sign-in: the SDK's BindleClient run server side (packages/runtime/redirect-management.mjs)
// against the SDK's in-process mock provider for the OAuth half, and the simulated portability network for the chain.
// Verified only against these doubles; no external provider conformance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockProvider } from '../packages/sdk/src/testing.mjs';
import { bindleRedirectSignin, redirectClientMetadata, REDIRECT_CLIENT_PATH, MANAGE_PATH, redirectManagementService } from '../packages/runtime/redirect-management.mjs';
import { RedirectManagementService } from '../packages/identity/redirect-management.mjs';
import { portabilityClient } from '../packages/identity/successors.mjs';
import { validateClientMetadata } from '../packages/federation/client-metadata.mjs';
import { managementFixture, A, B } from './helpers/redirect-management.mjs';

const SECRET = Buffer.alloc(32, 7).toString('base64');
async function setup({ addMoves = false } = {}) {
  const fx = await managementFixture();
  const subject = fx.hosts[B].state.get(fx.id.sub).identity;
  const provider = createMockProvider({ issuer: B, accounts: [{ handle: 'mover', displayName: 'Mover', subject }], clients: [{ clientId: A + REDIRECT_CLIENT_PATH, redirectUris: [A + MANAGE_PATH] }], declaration: 'standard', clientMetadata: true, clock: fx.clock.now });
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    const response = await provider.fetch(url, init);
    if (addMoves && new URL(url).pathname === '/oauth/token' && response.ok) { const json = await response.json(); return new Response(JSON.stringify({ ...json, bindle_origin: { iss: A, sub: fx.id.sub }, bindle_moves: fx.hosts[B].state.get(fx.id.sub).moves }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return response;
  };
  const signin = bindleRedirectSignin({ origin: A, secret: SECRET, fetcher, clock: fx.clock.now });
  fx.service = new RedirectManagementService({ records: fx.records, client: portabilityClient({ fetch: fx.world.net.fetch, clock: fx.clock.now }), signin, issuer: A, clock: fx.clock.now, log: event => fx.logs.push(event) });
  return { fx, provider, calls, signin };
}

test('the published client metadata is a valid public client-id-metadata.v1 document for the manage callback', () => {
  const doc = redirectClientMetadata('https://a.example');
  const parsed = validateClientMetadata(doc, doc.client_id);
  assert.ok(parsed); assert.deepEqual(doc.redirect_uris, ['https://a.example/transfer-manage']); assert.equal(doc.token_endpoint_auth_method, 'none');
});

test('server-side Bindle sign-in at the current provider ends the redirect; tokens are revoked; no state is kept server side', async () => {
  const { fx, provider, calls } = await setup();
  const started = await fx.service.begin({ identity: 'mover@b.example', action: 'end' });
  assert.equal(new URL(started.authorizationUrl).origin, B);
  assert.doesNotMatch(started.transaction, /[{}"]/, 'the transaction is sealed, not plain JSON');assert.ok(!Buffer.from(started.transaction.replace(/[^A-Za-z0-9_-]/g,''),'base64url').toString('latin1').includes('verifier'),'the transaction is sealed');
  const callback = provider.authorize(started.authorizationUrl);
  assert.deepEqual(await fx.service.complete({ transaction: started.transaction, callback }), { outcome: 'ended' });
  assert.equal((await fx.moved()).redirectBase, null);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(calls.some(call => call.url === `${B}/oauth/token` && String(call.body).includes('code_verifier=')), 'PKCE code exchange at the provider\'s token endpoint');
  assert.ok(calls.some(call => call.url === `${B}/oauth/revoke`), 'the evidence tokens are revoked');
  // The code is single use: replaying the same callback fails generically and changes nothing.
  await assert.rejects(() => fx.service.complete({ transaction: started.transaction, callback }), { code: 'sign_in_failed' });
});

test('bindle_origin/bindle_moves in the token response are carried and checked', async () => {
  const { fx, provider } = await setup({ addMoves: true });
  const started = await fx.service.begin({ identity: 'mover@b.example', action: 'end' });
  assert.deepEqual(await fx.service.complete({ transaction: started.transaction, callback: provider.authorize(started.authorizationUrl) }), { outcome: 'ended' });
});

test('a tampered, expired, foreign-state or wrong-callback transaction is refused before any token exchange', async () => {
  const { fx, provider, calls } = await setup();
  const started = await fx.service.begin({ identity: 'mover@b.example', action: 'end' });
  const callback = provider.authorize(started.authorizationUrl);
  const tampered = started.transaction.slice(0, -4) + (started.transaction.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(() => fx.service.complete({ transaction: tampered, callback }), { code: 'sign_in_failed' });
  const other = await fx.service.begin({ identity: 'mover@b.example', action: 'end' });
  await assert.rejects(() => fx.service.complete({ transaction: other.transaction, callback }), { code: 'sign_in_failed' }, 'a callback for another transaction');
  await assert.rejects(() => fx.service.complete({ transaction: started.transaction, callback: callback.replace('/transfer-manage', '/elsewhere') }), { code: 'sign_in_failed' });
  fx.clock.advance(11 * 60000);
  await assert.rejects(() => fx.service.complete({ transaction: started.transaction, callback }), { code: 'sign_in_failed' });
  assert.equal(calls.filter(call => call.url === `${B}/oauth/token`).length, 0);
  assert.equal((await fx.moved()).redirectBase !== null, true);
});

test('a declined authorization and an unknown provider are generic', async () => {
  const { fx, provider } = await setup();
  const started = await fx.service.begin({ identity: 'mover@b.example', action: 'end' });
  await assert.rejects(() => fx.service.complete({ transaction: started.transaction, callback: provider.authorize(started.authorizationUrl, { decision: 'deny' }) }), { code: 'sign_in_failed' });
  await assert.rejects(() => fx.service.begin({ identity: 'mover@nowhere.example', action: 'end' }), { code: 'sign_in_unavailable' });
});

test('composition: no egress or sealing key means no service', async () => {
  assert.equal(await redirectManagementService({ APP_ORIGIN: A, IDENTITY_REPOSITORY: {}, KEY_ENCRYPTION_KEY: SECRET }), null);
  assert.equal(await redirectManagementService({ APP_ORIGIN: A, IDENTITY_REPOSITORY: {}, TRANSFER_IN_PORTS: { fetch: async () => null } }), null);
  const fx = await managementFixture();
  const service = await redirectManagementService({ APP_ORIGIN: A, IDENTITY_REPOSITORY: fx.repository, KEY_ENCRYPTION_KEY: SECRET, TRANSFER_IN_PORTS: { fetch: fx.world.net.fetch } });
  assert.ok(service instanceof RedirectManagementService);
});
