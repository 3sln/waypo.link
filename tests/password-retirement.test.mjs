// Password removal (owner approval 2026-10-28, "drop passwords"; sign-in and intents spike §6.3, plan provisional):
// no password sign-up, sign-in, step-up, enrollment or storage remains; sessions that a password created or stepped up
// are refused; the bounded reset `passwords-retired-v1` strips password fields from accounts with another method and
// tombstones password-only identities; reruns are no-ops. Engine level over the in-memory and Worker repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, MemoryAccounts, memoryShards, signupInput, sessionContext, activate, context } from './helpers/identity-engine.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { planPasswordRetirement, retirePassword, retirePasswords, retireAllPasswords, PASSWORD_RETIREMENT_MARKER } from '../packages/identity/password-retirement.mjs';
import { passwordSession } from '../packages/identity/service.mjs';
import { TransferEnrollment } from '../packages/identity/transfer-enrollment.mjs';

const DAY = 86400000;
async function code(run) { try { await run(); } catch (error) { return error.code; } return 'ok'; }
/** A repository that also pages accounts (`lifecycleCandidates`), as both production repositories do. */
class PagedAccounts extends MemoryAccounts {
  async lifecycleCandidates({ cursor, limit = 100 } = {}) { const ids = [...this.records.keys()].sort(), start = cursor ? ids.indexOf(cursor) + 1 : 0, page = ids.slice(start, start + limit); return { accounts: page.map(id => ({ id, cursor: id })), cursor: start + limit < ids.length ? page.at(-1) : null }; }
}

test('no password sign-up, sign-in, pending password, step-up or transfer enrollment remains', async () => {
  const h = identityEngine();
  assert.equal(await code(() => h.act('signup', signupInput({ method: 'password', password: 'a long enough password!!' }))), 'invalid_method');
  assert.equal(await code(() => h.act('signup', signupInput({ password: 'a long enough password!!' }))), 'invalid_method', 'a password field is refused even beside the passkey method');
  for (const method of ['loginPassword', 'setPendingPassword']) await assert.rejects(() => h.act(method, {}), /Unknown identity action/);
  const enrollment = new TransferEnrollment({ identity: await h.engine.container.use(['identity'], ({ identity }) => identity), ports: {} });
  assert.equal(await code(() => enrollment.start({ method: 'password', password: 'a long enough password!!' }, context)), 'invalid_method');
  const { ownerContext } = await activate(h.act);
  assert.equal(await code(() => h.act('stepUp', { method: 'password', password: 'anything at all here' }, ownerContext)), 'invalid_method');
  const begin = await h.act('stepUpBegin', {}, ownerContext);
  assert.equal('password' in begin, false);
  assert.equal('hasPassword' in (await h.owner(ownerContext)).account, false);
});

test('a session that a password created or stepped up is refused', async () => {
  const h = identityEngine(), { owner, ownerContext } = await activate(h.act), id = owner.account.id;
  const record = h.repository.records.get(id), session = record.sessions.at(-1);
  session.stepUpCredential = { kind: 'password' };
  assert.equal(passwordSession(session), true);
  assert.equal(await code(() => h.owner(ownerContext)), 'unauthorized');
  delete session.stepUpCredential; session.credentialId = undefined; session.source = 'credential';
  assert.equal(await code(() => h.owner(ownerContext)), 'unauthorized', 'a password sign-in session (credential source, no passkey id)');
});

for (const kind of ['memory', 'worker']) test(`${kind}: the reset strips accounts with another method, tombstones password-only ones and is idempotent`, async t => {
  const clock = fakeClock(Date.UTC(2026, 9, 28)), shards = kind === 'worker' ? memoryShards() : null;
  const repository = shards ? shards.repository(clock.now) : new PagedAccounts();
  const h = identityEngine({ repository, clock });
  const keep = await activate(h.act, signupInput({ handle: 'keeper' })), only = await activate(h.act, signupInput({ handle: 'loner' }));
  const pending = await h.act('signup', signupInput({ handle: 'starter' }));
  const patch = async (id, fn) => { const current = await repository.get(id), revision = current.revision; fn(current); current.revision = revision + 1; assert.ok(await repository.compareAndSwap(id, revision, current)); };
  // Legacy shapes: a password beside a passkey (with a password-stepped-up session), a password-only active account, and
  // a pending sign-up that chose a password.
  await patch(keep.owner.account.id, a => { a.passwordHash = 'argon2id$legacy'; a.passwordSetAt = clock.now() - DAY; a.sessions.at(-1).stepUpCredential = { kind: 'password' }; });
  await patch(only.owner.account.id, a => { a.passwordHash = 'argon2id$legacy'; a.passwordSetAt = clock.now() - DAY; a.credentials = []; });
  await patch(pending.account.id, a => { a.passwordHash = 'argon2id$legacy'; a.passwordSetAt = clock.now(); });
  assert.equal(planPasswordRetirement(await repository.get(keep.owner.account.id)), 'strip');
  assert.equal(planPasswordRetirement(await repository.get(only.owner.account.id)), 'reset');
  assert.equal(planPasswordRetirement(await repository.get(pending.account.id)), 'reset');
  const before = (await repository.get(keep.owner.account.id)).security.epoch;
  const identity = h.engine.container.use(['identity'], ({ identity }) => identity);
  const run = await retireAllPasswords(await identity, { limit: 2 });
  assert.deepEqual({ stripped: run.stripped, reset: run.reset, failed: run.failed, done: run.done }, { stripped: 1, reset: 2, failed: 0, done: true });
  const kept = await repository.get(keep.owner.account.id);
  assert.equal('passwordHash' in kept, false); assert.equal('passwordSetAt' in kept, false);
  assert.equal(kept.security.epoch, before + 1);
  assert.equal(kept.sessions.some(passwordSession), false, 'the password-stepped-up session ended');
  assert.equal(kept.credentials.length, 1, 'the passkey stays');
  for (const id of [only.owner.account.id, pending.account.id]) { const gone = await repository.get(id); assert.equal(gone.status, 'deleted'); assert.equal(gone.audit[0].event, 'account-deleted-password-retired'); }
  assert.equal(await code(() => h.owner(only.ownerContext)), 'unauthorized');
  // Idempotent: a second run changes nothing.
  const again = await retirePasswords(await identity, {});
  assert.deepEqual({ stripped: again.stripped, reset: again.reset }, { stripped: 0, reset: 0 });
  assert.deepEqual(await retirePassword(await identity, keep.owner.account.id), { action: 'none' });
});

test('the marker makes later full runs skip; a run with failures leaves no marker', async () => {
  const repository = new PagedAccounts(), h = identityEngine({ repository }), identity = await h.engine.container.use(['identity'], ({ identity }) => identity);
  const rows = new Map(), marker = { get: async key => rows.get(key), put: async (key, value) => rows.set(key, value) };
  await activate(h.act);
  const first = await retireAllPasswords(identity, { marker });
  assert.equal(first.done, true); assert.ok(rows.has(PASSWORD_RETIREMENT_MARKER));
  assert.deepEqual(await retireAllPasswords(identity, { marker }), { done: true, skipped: true });
  const broken = { ...identity, repository: { lifecycleCandidates: async () => ({ accounts: [{ id: 'x' }], cursor: null }), get: async () => { throw new Error('down'); } }, clock: () => 0 };
  const rows2 = new Map(), marker2 = { get: async key => rows2.get(key), put: async (key, value) => rows2.set(key, value) };
  const failed = await retireAllPasswords(broken, { marker: marker2 });
  assert.equal(failed.failed, 1); assert.equal(rows2.size, 0);
  assert.ok(context.origin);
});
