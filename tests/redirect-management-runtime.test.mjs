// Redirect management HTTP adapters (packages/runtime/routes/transfer-pages.mjs): same-origin intent headers, the env
// kill switch, unconfigured egress, the uniform 404, the client metadata document and the callback page's query policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import runtime from '../packages/runtime/http.mjs';
import { managementFixture, A, B } from './helpers/redirect-management.mjs';
import { redirectClientMetadata } from '../packages/runtime/redirect-management.mjs';

async function setup(extra = {}) {
  const fx = await managementFixture();
  const signin = { begin: async ({ intent }) => ({ authorizationUrl: `${B}/oauth/authorize?entry=e`, transaction: JSON.stringify(intent) }), complete: async ({ transaction }) => ({ token: structuredClone(fx.token), intent: JSON.parse(transaction) }) };
  const env = { APP_ORIGIN: A, KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), MOVED_CLOCK: fx.clock.now, ABUSE: { consume: async () => true }, IDENTITY_REPOSITORY: fx.repository, REDIRECT_MANAGEMENT_FETCH: fx.world.net.fetch, REDIRECT_MANAGEMENT_SIGNIN: signin, ASSETS: { fetch: async () => new Response('<html><head></head><body>manage</body></html>') }, ACCOUNTS: { get: () => { throw Error('Must not wake an account'); } }, ...extra };
  return { fx, env };
}
const post = (env, path, body, headers = { Origin: A, 'X-Bindle-Transfer': '1' }) => runtime.fetch(new Request(A + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);

test('manage endpoints need same-origin intent headers and follow the transfer-out kill switch; unconfigured egress is 503', async () => {
  const { env } = await setup();
  for (const headers of [{}, { Origin: 'https://attacker.example', 'X-Bindle-Transfer': '1' }, { Origin: A }, { Origin: A, 'X-Bindle-Transfer': '1', 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await post(env, '/api/portability/redirect/manage/begin', { identity: 'm@b.example', action: 'end' }, headers)).status, 403);
  const killed = await post({ ...env, IDENTITY_TRANSFER_OUT_ENABLED: 'false' }, '/api/portability/redirect/manage/begin', { identity: 'm@b.example', action: 'end' });
  assert.equal(killed.status, 404); assert.deepEqual(await killed.json(), { error: 'not_found' });
  const unconfigured = await post({ ...env, REDIRECT_MANAGEMENT_FETCH: undefined }, '/api/portability/redirect/manage/begin', { identity: 'm@b.example', action: 'end' });
  assert.equal(unconfigured.status, 503);
  assert.equal((await runtime.fetch(new Request(A + '/api/portability/redirect/manage/begin'), env)).status, 405);
  assert.equal((await post(env, '/api/portability/redirect/manage/begin', { identity: 'm@b.example', action: 'end' }, { Origin: A, 'X-Bindle-Transfer': '1', Authorization: 'Bearer x' })).status, 404);
});

test('begin then complete ends the redirect over HTTP; a forged sign-in answers exactly as an unknown identity', async () => {
  const { fx, env } = await setup();
  const begun = await post(env, '/api/portability/redirect/manage/begin', { identity: 'mover@b.example', action: 'end' });
  assert.equal(begun.status, 200, await begun.clone().text()); const started = await begun.json();
  assert.equal(new URL(started.authorizationUrl).origin, B); assert.match(begun.headers.get('Cache-Control'), /no-store/);
  // Forged: another identity's sign-in.
  fx.token = { issuer: B, subject: `${B}/identity/00000000-0000-4000-8000-000000000000` };
  const forged = await post(env, '/api/portability/redirect/manage/complete', { transaction: started.transaction, callback: `${A}/transfer-manage?code=c&state=s&iss=x` });
  fx.repository.rows.set('ffffffff-ffff-4fff-8fff-ffffffffffff', { id: 'x' });
  fx.token = { issuer: B, subject: `${B}/identity/ffffffff-ffff-4fff-8fff-ffffffffffff` };
  const unknown = await post(env, '/api/portability/redirect/manage/complete', { transaction: started.transaction, callback: `${A}/transfer-manage?code=c&state=s&iss=x` });
  assert.equal(forged.status, 404); assert.equal(unknown.status, 404); assert.equal(await forged.text(), await unknown.text());
  fx.signedInAt(fx.hosts[B]);
  const done = await post(env, '/api/portability/redirect/manage/complete', { transaction: started.transaction, callback: `${A}/transfer-manage?code=c&state=s&iss=x` });
  assert.equal(done.status, 200, await done.clone().text()); assert.deepEqual(await done.json(), { outcome: 'ended' });
  assert.equal((await fx.moved()).redirectBase, null);
});

test('the client metadata document and the callback page', async () => {
  const { env } = await setup();
  const doc = await runtime.fetch(new Request(A + '/bindle/portability/redirect-client'), env);
  assert.equal(doc.status, 200); assert.deepEqual(await doc.json(), redirectClientMetadata(A));
  assert.equal((await runtime.fetch(new Request(A + '/bindle/portability/redirect-client?x=1'), env)).status, 404);
  assert.equal((await runtime.fetch(new Request(A + '/bindle/portability/redirect-client', { method: 'POST' }), env)).status, 405);
  assert.equal((await runtime.fetch(new Request(A + '/transfer-manage'), env)).status, 200);
  assert.equal((await runtime.fetch(new Request(A + '/transfer-manage?code=c&state=s&iss=https%3A%2F%2Fb.example'), env)).status, 200);
  assert.equal((await runtime.fetch(new Request(A + '/transfer-manage?error=access_denied&state=s&iss=x'), env)).status, 200);
  for (const query of ['?code=a&code=b', '?next=https://evil.example', '?recoveryToken=x']) assert.equal((await runtime.fetch(new Request(A + '/transfer-manage' + query), env)).status, 404, query);
  assert.equal((await runtime.fetch(new Request(A + '/transfer-manage', { headers: { Authorization: 'Bearer x' } }), env)).status, 404);
});
