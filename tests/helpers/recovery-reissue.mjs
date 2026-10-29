// Engine-level fixture for the active-account recovery reissue: the durable Node runtime (real account objects, real
// identity repository, real key registry and transfer-out service) with a separately constructed IdentityService, so
// the test owns the identity clock, the step-up evidence and the notice ports. Passwords were dropped (owner approval
// 2026-10-28): the owner signs up with the deterministic fake passkey `passkey-1` (tests/helpers/identity-engine.mjs
// `fakeWebAuthn`), and every step-up and second session is a passkey one.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeServer } from '../../apps/node/server.mjs';
import { IdentityService } from '../../packages/identity/service.mjs';
import { identityBackupPort } from '../../packages/runtime/identity-backup.mjs';
import { verifyKeyContinuity } from '../../packages/identity/keys.mjs';
import { TRANSFER_KEY, LOCK_KEY } from '../../packages/identity/transfer-out.mjs';
import { REQUEST_KEY } from '../../packages/runtime/account-deletion.mjs';
import { fakeWebAuthn, passkeyResponse } from './identity-engine.mjs';

export const DAY = 86400000, HOUR = 3600000, MINUTE = 60000, DEST = 'https://dest.example';
export const ORIGIN = 'http://localhost:8788', EMAIL = 'owner@reissue.example', PASSKEY = 'passkey-1';
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
    turnstile: { verify: async () => true }, rateLimiter: { check: async () => true }, webauthn: fakeWebAuthn(), clock,
    mailer: { sendSecurityAlert: async value => { mail.push(value); } },
    accountChannels: { state: async () => ({ ready: true, count: 1, revision: 'r' }), notify: async (owner, event) => { push.push({ owner, event }); return { accepted: 1 }; } },
    config: { origin: ORIGIN, rpID: 'localhost', termsVersion: '2026-10-11', allowInsecureLocalhost: true } });
  const base = { origin: ORIGIN, remoteIP: '127.0.0.1' };
  const pending = await service.signup({ method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'ok' }, base);
  await service.registerPasskey({ pendingToken: pending.pendingToken, response: passkeyResponse(pending, PASSKEY) }, base);
  const id = pending.account.id, handle = pending.account.handle;
  const downloaded = await service.downloadRecovery({ pendingToken: pending.pendingToken }, base);
  const session = await service.confirmRecovery({ pendingToken: pending.pendingToken, recoveryToken: downloaded.recoveryToken, downloadConfirmed: true }, base);
  const ctx = { ...base, sessionToken: session.sessionToken, csrfToken: session.csrfToken };
  const raw = app.resources.repository, c = app.resources.accounts.get(id);
  const patch = async mutate => { const account = await raw.get(id), next = mutate(structuredClone(account)); next.revision = account.revision + 1; if (!await raw.compareAndSwap(id, account.revision, next)) throw new Error('patch'); };
  await patch(a => ({ ...a, verifiedEmail: EMAIL, emailVerifiedAt: now - 30 * DAY }));
  const snapshot = await raw.get(id);
  const f = {
    app, service, repository: raw, c, id, handle, ctx, credentialId: PASSKEY, sessionId: session.sessionContext, mail, push, clock,
    file: { recoveryToken: downloaded.recoveryToken, fileId: downloaded.fileId, payload: JSON.parse(downloaded.content) },
    now: () => now, advance: ms => { now += ms; }, patch,
    identity: () => raw.get(id), identityBefore: async () => snapshot,
    /** Every passkey enrolled more than 7 days ago. The current file's issue time moves with them (as if the whole
     * account were 8 days older), so the signup passkey stays exactly as old as the file and is NOT file-proof
     * (`fileProofReissue`: a passkey enrolled before the previous file); tests that need file-proof age it further. */
    age: () => patch(a => ({ ...a, ...typeof a.recoveryHash === 'string' && a.recoveryHash ? { recoveryIssuedAt: now - 8 * DAY } : {}, credentials: a.credentials.map(entry => ({ ...entry, createdAt: now - 8 * DAY })) })),
    /** A passkey step-up with `credentialId`; any other method goes to the service as given (and is refused). */
    async stepUp(method = 'passkey', context = ctx, credentialId = PASSKEY) { if (method !== 'passkey') return service.stepUp({ method }, context); const begin = await service.stepUpBegin({}, context); return service.stepUp({ method: 'passkey', response: passkeyResponse(begin, credentialId) }, context); },
    begin: (input = { acknowledged: true }, context = ctx) => service.reissueRecoveryBegin(input, context),
    parse: result => ({ ...result, payload: JSON.parse(result.content) }),
    confirm: (staged, extra = {}, context = ctx) => service.reissueRecoveryConfirm({ recoveryToken: staged.recoveryToken, fileId: staged.fileId, downloadConfirmed: true, ...extra }, context),
    recover: file => service.recover({ recoveryToken: file.recoveryToken, turnstileToken: 'ok' }, base),
    owner: (context = ctx) => service.owner({}, context),
    async secondSession(credentialId = PASSKEY) { const begin = await service.beginPasskeyLogin({ handle, turnstileToken: 'ok' }, base), result = await service.finishPasskeyLogin({ challengeToken: begin.challengeToken, response: passkeyResponse(begin, credentialId) }, base); return { ...base, sessionToken: result.sessionToken, csrfToken: result.csrfToken, sessionId: result.sessionContext }; },
    keyState: async kid => (await c.identitySigningKey(id, kid))?.state,
    async continuity(previous, next) { const history = await c.identityKeyHistory(id, { purpose: 'signing' }); return verifyKeyContinuity({ signer: history.find(k => k.kid === previous), next: history.find(k => k.kid === next), subject: id }); },
    /** A transfer-out record in `state` (white-box: the transfer-out engine's own tests cover how one gets there). */
    seedTransfer: ({ state }) => c.metadata.put(TRANSFER_KEY, { id: 't-1', revision: 1, owner: id, state, path: 'a', destination: DEST, round: 1, createdAt: now, credential: { ref: 'ref', issuedAt: now - 10 * DAY }, channels: null, tokens: [], hold: state === 'held' ? { at: now, expiresAt: now + 30 * DAY } : null }),
  };
  return f;
}
