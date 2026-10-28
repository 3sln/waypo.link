// Engine-level fixture for the active-account recovery reissue: the durable Node runtime (real account objects, real
// identity repository, real key registry and transfer-out service) with a separately constructed IdentityService, so
// the test owns the identity clock, the step-up evidence and the notice ports.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../../apps/node/server.mjs';
import { IdentityService } from '../../packages/identity/service.mjs';
import { identityBackupPort } from '../../packages/runtime/identity-backup.mjs';
import { verifyKeyContinuity } from '../../packages/identity/keys.mjs';
import { TRANSFER_KEY, LOCK_KEY } from '../../packages/identity/transfer-out.mjs';
import { REQUEST_KEY } from '../../packages/runtime/account-deletion.mjs';
import { fakeHasher } from './identity-engine.mjs';

export const DAY = 86400000, HOUR = 3600000, MINUTE = 60000, DEST = 'https://dest.example';
export const ORIGIN = 'http://localhost:8788', PASSWORD = 'Active account reissue test password!', EMAIL = 'owner@reissue.example';
export { TRANSFER_KEY, LOCK_KEY, REQUEST_KEY };

/** `options.wrap(target, label)` interposes a scheduler or fault injector on the repository and account stubs. */
export async function reissueFixture(t, { wrap = target => target, start = Date.now() } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-reissue-'));
  const app = await createNodeServer({ directory, config: {} });
  t?.after?.(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const authority = await readFile(join(directory, 'recovery-signing-key'), 'utf8');
  let now = start; const clock = () => now, mail = [], push = [];
  const repository = wrap(app.resources.repository, 'identity'), accounts = { get: owner => wrap(app.resources.accounts.get(owner), 'account') };
  const service = new IdentityService({ repository, identityBackup: identityBackupPort({ config: { APP_ORIGIN: ORIGIN, RECOVERY_SIGNING_KEY: authority }, accounts }),
    turnstile: { verify: async () => true }, rateLimiter: { check: async () => true }, webauthn: {}, passwordHasher: fakeHasher, clock,
    mailer: { sendSecurityAlert: async value => { mail.push(value); } },
    accountChannels: { state: async () => ({ ready: true, count: 1, revision: 'r' }), notify: async (owner, event) => { push.push({ owner, event }); return { accepted: 1 }; } },
    config: { origin: ORIGIN, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  const base = { origin: ORIGIN, remoteIP: '127.0.0.1' };
  const pending = await service.signup({ method: 'password', password: PASSWORD, ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'ok' }, base);
  const id = pending.account.id, handle = pending.account.handle;
  const downloaded = await service.downloadRecovery({ pendingToken: pending.pendingToken }, base);
  const session = await service.confirmRecovery({ pendingToken: pending.pendingToken, recoveryToken: downloaded.recoveryToken, downloadConfirmed: true }, base);
  const ctx = { ...base, sessionToken: session.sessionToken, csrfToken: session.csrfToken };
  const raw = app.resources.repository, c = app.resources.accounts.get(id);
  const patch = async mutate => { const account = await raw.get(id), next = mutate(structuredClone(account)); next.revision = account.revision + 1; if (!await raw.compareAndSwap(id, account.revision, next)) throw new Error('patch'); };
  await patch(a => ({ ...a, verifiedEmail: EMAIL, emailVerifiedAt: now - 30 * DAY }));
  const snapshot = await raw.get(id);
  const f = {
    app, service, repository: raw, c, id, handle, ctx, sessionId: session.sessionContext, mail, push, clock,
    file: { recoveryToken: downloaded.recoveryToken, fileId: downloaded.fileId, payload: JSON.parse(downloaded.content) },
    now: () => now, advance: ms => { now += ms; }, patch,
    identity: () => raw.get(id), identityBefore: async () => snapshot,
    /** Every credential enrolled more than 7 days ago. */
    age: () => patch(a => ({ ...a, passwordSetAt: now - 8 * DAY, credentials: a.credentials.map(entry => ({ ...entry, createdAt: now - 8 * DAY })) })),
    stepUp: (method = 'password', context = ctx) => service.stepUp({ method, password: PASSWORD }, context),
    begin: (input = { acknowledged: true }, context = ctx) => service.reissueRecoveryBegin(input, context),
    parse: result => ({ ...result, payload: JSON.parse(result.content) }),
    confirm: (staged, extra = {}, context = ctx) => service.reissueRecoveryConfirm({ recoveryToken: staged.recoveryToken, fileId: staged.fileId, downloadConfirmed: true, ...extra }, context),
    recover: file => service.recover({ recoveryToken: file.recoveryToken, turnstileToken: 'ok' }, base),
    owner: (context = ctx) => service.owner({}, context),
    async secondSession() { const result = await service.loginPassword({ handle, password: PASSWORD, turnstileToken: 'ok' }, base); return { ...base, sessionToken: result.sessionToken, csrfToken: result.csrfToken, sessionId: result.sessionContext }; },
    keyState: async kid => (await c.identitySigningKey(id, kid))?.state,
    async continuity(previous, next) { const history = await c.identityKeyHistory(id, { purpose: 'signing' }); return verifyKeyContinuity({ signer: history.find(k => k.kid === previous), next: history.find(k => k.kid === next), subject: id }); },
    /** A transfer-out record in `state` (white-box: the transfer-out engine's own tests cover how one gets there). */
    seedTransfer: ({ state }) => c.metadata.put(TRANSFER_KEY, { id: 't-1', revision: 1, owner: id, state, path: 'a', destination: DEST, round: 1, createdAt: now, credential: { ref: 'ref', issuedAt: now - 10 * DAY }, channels: null, tokens: [], hold: state === 'held' ? { at: now, expiresAt: now + 30 * DAY } : null }),
  };
  return f;
}
