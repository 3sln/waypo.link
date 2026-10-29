// Engine-level identity fixture: the real IdentityService inside an ngin Engine,
// with every pluggable resource replaced by an in-memory or fake one. Passkeys use
// a deterministic fake WebAuthn adapter (`fakeWebAuthn`): a response is accepted
// when it echoes the issued challenge and names a registered credential. Passwords
// were dropped (owner approval 2026-10-28); `fakeHasher` remains for the operator
// boot principal only.
import { createIdentityEngine, IdentityAction, OwnerQuery } from '../../packages/identity/index.mjs';
import { ShardedIdentityRepository, IdentityShardStorage, IDENTITY_LAYOUT } from '../../packages/runtime/identity-shards.mjs';
import { indexedEmails } from '../../packages/identity/emails.mjs';
import { createHash } from 'node:crypto';
import { fakeClock } from './chaos.mjs';

export const config = { origin: 'https://3sln.example', rpID: '3sln.example', rpName: '3sln', termsVersion: '2026-10-11', linkedCodeKey: 'test-linked-code-key-0001' };
export const context = { origin: config.origin, remoteIP: '192.0.2.1' };
export const signupInput = (overrides = {}) => ({ handle: 'alice', method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: config.termsVersion, turnstileToken: 'verified', ...overrides });

/** Linearizable Map repository with the IdentityService repository contract. */
export class MemoryAccounts {
  records = new Map();
  async get(id) { return structuredClone(this.records.get(id)); }
  async findByHandle(handle) { return structuredClone([...this.records.values()].find(a => a.handle === handle)); }
  async findByEmail(email) { return structuredClone([...this.records.values()].find(a => indexedEmails(a).includes(email))); }
  async create(account) { if (this.records.has(account.id) || [...this.records.values()].some(a => a.handle === account.handle)) return false; this.records.set(account.id, structuredClone(account)); return true; }
  async compareAndSwap(id, revision, account) {
    if (this.records.get(id)?.revision !== revision || indexedEmails(account).some(email => [...this.records.values()].some(a => a.id !== id && indexedEmails(a).includes(email)))) return false;
    this.records.set(id, structuredClone(account)); return true;
  }
}
export class MemoryDevices {
  records = new Map();
  async get(id) { return structuredClone(this.records.get(id)); }
  async findByUserCode(code) { return structuredClone([...this.records.values()].find(value => value.userCodeHash === code)); }
  async create(value) { if (this.records.has(value.id) || [...this.records.values()].some(record => record.userCodeHash === value.userCodeHash)) return false; this.records.set(value.id, structuredClone(value)); return true; }
  async compareAndSwap(id, revision, value) { if (this.records.get(id)?.revision !== revision) return false; this.records.set(id, structuredClone(value)); return true; }
}
/** Serialized in-memory transactional metadata, the contract IdentityShardStorage needs. */
export class MemoryMetadata {
  rows = new Map(); queue = Promise.resolve();
  async get(key) { return structuredClone(this.rows.get(key)); }
  async put(key, value) { this.rows.set(key, structuredClone(value)); }
  async delete(key) { this.rows.delete(key); }
  async list({ prefix = '', startAfter = '', limit = 100 } = {}) { return new Map([...this.rows].filter(([key]) => key.startsWith(prefix) && key > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)); }
  async transaction(operation) { const result = this.queue.then(async () => { const old = structuredClone(this.rows); try { return await operation(this); } catch (error) { this.rows = old; throw error; } }); this.queue = result.catch(() => {}); return result; }
}
/** Sharded identity storage: one IdentityShardStorage per shard name, reached
 * through `shardX` RPC-shaped calls like the Worker/Node adapters. `wrap` lets a
 * test interpose a scheduler or fault injector on each shard stub. */
export function memoryShards({ wrap = stub => stub } = {}) {
  const controllers = new Map(), stubs = new Map();
  const shard = name => {
    if (!stubs.has(name)) {
      const controller = new IdentityShardStorage(new MemoryMetadata()); controllers.set(name, controller);
      const stub = new Proxy({}, { get: (_, method) => method === 'then' || typeof method === 'symbol' ? undefined : (...args) => controller[method.slice(5, 6).toLowerCase() + method.slice(6)](...args) });
      stubs.set(name, wrap(stub, name));
    }
    return stubs.get(name);
  };
  return { shard, controllers, repository: clock => new ShardedIdentityRepository({ shard, layout: IDENTITY_LAYOUT, clock }) };
}
const digest = value => `fake:${createHash('sha256').update(value).digest('base64url')}`;
/** Deterministic WebAuthn: options carry a fresh challenge; a response {id, challenge} verifies when it echoes the
 * challenge (registration) or also names the stored credential (assertion). Counters increase on every assertion. */
export function fakeWebAuthn() {
  let next = 0;
  const challenge = () => `challenge-${++next}`;
  return {
    registrationOptions: async () => ({ challenge: challenge() }),
    authenticationOptions: async () => ({ challenge: challenge() }),
    verifyRegistration: async ({ response, challenge: expected }) => { if (!response || response.challenge !== expected || typeof response.id !== 'string') throw new Error('invalid registration'); return { id: response.id, publicKey: 'fake-public-key', counter: 0, transports: [], deviceType: 'multiDevice', backedUp: true }; },
    verifyAuthentication: async ({ response, challenge: expected, credential }) => { if (!response || response.challenge !== expected || response.id !== credential.id) throw new Error('invalid assertion'); return { counter: (credential.counter ?? 0) + 1, backedUp: credential.backedUp ?? true }; },
  };
}
/** The response a fake authenticator gives for `options` with credential `id`. */
export const passkeyResponse = (options, id = 'passkey-1') => ({ id, challenge: (options?.registrationOptions ?? options?.authenticationOptions ?? options)?.challenge });
export const fakeHasher = { dummyHash: digest('dummy'), hash: async value => digest(value), verify: async (value, encoded) => encoded === digest(value) };

export function identityEngine({ repository = new MemoryAccounts(), deviceRequests = new MemoryDevices(), clock = fakeClock(), mailer, rateLimiter = { check: async () => true }, ...overrides } = {}) {
  const mail = [];
  const resources = { repository, deviceRequests, clock: clock.now, config, turnstile: { verify: async ({ token }) => token === 'verified' }, rateLimiter,
    webauthn: fakeWebAuthn(),
    mailer: mailer ?? { sendVerification: async value => { mail.push(value); }, sendSetupCode: async value => { mail.push(value); } }, ...overrides };
  // The app's own engine wiring; `service` reaches methods that are not
  // dispatchable actions (owner reads, step-up) through the engine container.
  const engine = createIdentityEngine(resources);
  const service = new Proxy({}, { get: (_, method) => (...args) => engine.container.use(['identity'], ({ identity }) => identity[method](...args)) });
  /** Dispatch one identity action and resolve with its result (rejects with the IdentityFault). */
  const act = async (method, input, ctx = context) => (await engine.dispatch(new IdentityAction(method, input, ctx)).next('result')).detail;
  const owner = ctx => engine.query(new OwnerQuery(ctx)).peek();
  return { engine, service, act, owner, repository, deviceRequests, clock, mail, resources };
}
/** Signup (passkey) → passkey registration → recovery download → confirmation → passkey step-up, all through engine
 * dispatch. The passkey id is `passkey-<handle>` unless `passkeyId` is given. */
export async function activate(act, input = signupInput(), { passkeyId } = {}) {
  const pending = await act('signup', input);
  const credentialId = passkeyId ?? `passkey-${input.handle ?? 'alice'}`;
  await act('registerPasskey', { pendingToken: pending.pendingToken, response: passkeyResponse(pending, credentialId) });
  const file = await act('downloadRecovery', { pendingToken: pending.pendingToken });
  const owner = await act('confirmRecovery', { pendingToken: pending.pendingToken, recoveryToken: file.recoveryToken, downloadConfirmed: true });
  await stepUpPasskey(act, sessionContext(owner), credentialId);
  return { pending, file, owner, ownerContext: sessionContext(owner), credentialId };
}
/** A passkey step-up for `ctx` with credential `id` (stepUpBegin is a dispatchable action). */
export async function stepUpPasskey(act, ctx, id) {
  const begin = await act('stepUpBegin', {}, ctx);
  return act('stepUp', { method: 'passkey', response: passkeyResponse(begin, id) }, ctx);
}
/** A passkey sign-in for `handle` with credential `id`; resolves the session result. */
export async function signInPasskey(act, handle, id, ctx = context) {
  const begin = await act('beginPasskeyLogin', { handle, turnstileToken: 'verified' }, ctx);
  return act('finishPasskeyLogin', { challengeToken: begin.challengeToken, response: passkeyResponse(begin, id) }, ctx);
}
export const sessionContext = (result, base = context) => ({ ...base, sessionToken: result.sessionToken, csrfToken: result.csrfToken });
