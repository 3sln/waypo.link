// Password removal (owner approval 2026-10-28, "drop passwords"; sign-in and intents spike §6.3, plan provisional):
// no password sign-up, sign-in, step-up, enrollment or storage remains; sessions that a password created or stepped up
// are refused; the bounded reset `passwords-retired-v1` strips password fields from accounts with another method and
// tombstones password-only identities; reruns are no-ops. Engine level over the in-memory and Worker repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityEngine, MemoryAccounts, memoryShards, signupInput, sessionContext, activate, context } from './helpers/identity-engine.mjs';
import { fakeClock } from './helpers/chaos.mjs';
import { planPasswordRetirement, retirePassword, retirePasswords, retireAllPasswords, retirePasswordsStep, PASSWORD_RETIREMENT_MARKER } from '../packages/identity/password-retirement.mjs';
import { passwordSession, passwordDerived } from '../packages/identity/service.mjs';
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

test('review 2026-10-29 L1: an activation session of a record that still carries password fields, and any session approved from a password session, are refused', async () => {
  const h = identityEngine(), { owner, ownerContext } = await activate(h.act), id = owner.account.id, record = h.repository.records.get(id);
  const activation = record.sessions.find(s => s.source === 'activation');
  assert.equal(passwordDerived(record, activation), false); await h.owner(ownerContext);
  record.passwordSetAt = h.clock.now() - DAY;
  assert.equal(passwordDerived(record, activation), true);
  assert.equal(await code(() => h.owner(ownerContext)), 'unauthorized', 'a password sign-up activation');
  delete record.passwordSetAt;
  const child = { id: 'child', source: 'linked-approval', parentSessionId: activation.id }, grandchild = { id: 'grandchild', source: 'linked-approval', parentSessionId: 'child' };
  record.sessions.push(child, grandchild);
  assert.equal(passwordDerived(record, grandchild), false);
  activation.stepUpCredential = { kind: 'password' };
  assert.equal(passwordDerived(record, grandchild), true, 'derived through the chain');
  assert.equal(passwordDerived({ ...record, sessions: [grandchild] }, grandchild), false, 'a missing parent without password fields is not evidence');
  assert.equal(passwordDerived({ ...record, passwordHash: 'x', sessions: [grandchild] }, grandchild), true, 'with password fields a missing parent fails closed');
});

test('review 2026-10-29 L2: the reset is revision-checked; a record that changed after planning (a passkey added) is planned again and stripped, not deleted', async () => {
  const repository = new PagedAccounts(), h = identityEngine({ repository }), identity = await h.engine.container.use(['identity'], ({ identity }) => identity);
  const { owner } = await activate(h.act), id = owner.account.id;
  Object.assign(repository.records.get(id), { passwordHash: 'argon2id$legacy', passwordSetAt: h.clock.now() - DAY, credentials: [] });
  assert.equal(planPasswordRetirement(await repository.get(id)), 'reset');
  // Between the plan's read and the tombstone, the owner registers a passkey (another writer, one revision later).
  const get = repository.get.bind(repository); let raced = false;
  repository.get = async key => { const value = await get(key); if (!raced && key === id) { raced = true; const live = repository.records.get(id); live.credentials = [{ id: 'passkey-new', publicKey: 'pk', counter: 0, createdAt: h.clock.now() }]; live.revision++; } return value; };
  assert.deepEqual(await retirePassword(identity, id), { action: 'stripped' });
  const kept = await get(id); assert.equal(kept.status, 'active'); assert.equal('passwordHash' in kept, false); assert.equal(kept.credentials[0].id, 'passkey-new');
  assert.equal(kept.sessions.some(s => s.source === 'activation'), false, 'the password sign-up activation session ended with the strip');
});

test('the strip ends app lineages approved before password removal that cannot be checked; the Worker step keeps a cursor and a marker', async () => {
  const repository = new PagedAccounts(), h = identityEngine({ repository }), identity = await h.engine.container.use(['identity'], ({ identity }) => identity);
  const a = await activate(h.act), b = await activate(h.act, signupInput({ handle: 'bob' }));
  const record = repository.records.get(a.owner.account.id);
  Object.assign(record, { passwordHash: 'argon2id$legacy', linkedLineage: [
    { id: 'old', sessions: ['gone'], sessionExpiresAt: 1, families: ['f-old'], expiresAt: Number.MAX_SAFE_INTEGER },
    { id: 'new', sessions: ['gone'], sessionExpiresAt: 1, families: ['f-new'], expiresAt: Number.MAX_SAFE_INTEGER, passwordFree: true }] });
  const rows = new Map(), store = { get: async key => rows.get(key), put: async (key, value) => { rows.set(key, value); }, delete: async key => { rows.delete(key); } };
  const first = await retirePasswordsStep(identity, store, { limit: 1, budgetMs: 0 });
  assert.equal(first.done, false); assert.ok(rows.has(`${PASSWORD_RETIREMENT_MARKER}/progress`), 'one slice, cursor kept');
  let result = first; while (!result.done) result = await retirePasswordsStep(identity, store, { limit: 1, budgetMs: 0 });
  assert.equal(result.stripped, 1); assert.ok(rows.has(PASSWORD_RETIREMENT_MARKER)); assert.equal(rows.has(`${PASSWORD_RETIREMENT_MARKER}/progress`), false);
  const after = await repository.get(a.owner.account.id);
  assert.deepEqual(after.linkedLineage.map(entry => entry.id), ['new']); assert.deepEqual(after.lineageOutbox.map(item => item.familyId), ['f-old']);
  assert.deepEqual(await retirePasswordsStep(identity, store), { done: true, skipped: true });
  assert.ok(b.owner);
});
