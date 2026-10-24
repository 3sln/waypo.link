// Engine-level fixture for redirect management (packages/identity/redirect-management.mjs) over the simulated
// portability network (tests/helpers/portability-network.mjs): host A plays this provider (3sln.me), with a real moved
// tombstone in an in-memory identity repository; B, C, E are other providers; E is the attacker's host. The Bindle
// sign-in is a fake `signin` port whose token response the test chooses (the SDK adapter has its own tests).
import { fakeClock } from './chaos.mjs';
import { World } from './portability-network.mjs';
import { portabilityClient } from '../../packages/identity/successors.mjs';
import { statementDigest, parseMoveStatement, attestationKeyThumbprint } from '../../packages/identity/succession.mjs';
import { RedirectManagementService } from '../../packages/identity/redirect-management.mjs';
import { redirectRecordsPort } from '../../packages/identity/redirect-records.mjs';

export const A = 'https://a.example', B = 'https://b.example', C = 'https://c.example', D = 'https://d.example', E = 'https://e.example';
export const DAY = 86400000;

export function memoryRepository(rows = new Map()) {
  return {
    rows,
    async get(id) { return structuredClone(rows.get(id) ?? null); },
    async compareAndSwap(id, revision, next) { const current = rows.get(id); if (!current || current.revision !== revision) return false; rows.set(id, structuredClone(next)); return true; },
  };
}

/** `destinationKeys`: whether the commit captured B's attestation keys (default yes). */
export async function managementFixture({ destinationKeys = true, providers = [A, B, C, D, E], redirectDays = 90 } = {}) {
  const clock = fakeClock(Date.UTC(2026, 9, 23, 12)), world = new World({ clock });
  const hosts = {}; for (const origin of providers) hosts[origin] = await world.provider(origin);
  const id = await world.identity();
  world.host(hosts[A], id);
  const r1 = await world.move(id, hosts[A], hosts[B]);
  const repository = memoryRepository(), now = clock.now();
  const thumbprints = destinationKeys ? await Promise.all(hosts[B].set.keys.map(key => attestationKeyThumbprint({ kty: key.publicJwk.kty, crv: key.publicJwk.crv, x: key.publicJwk.x, y: key.publicJwk.y }))) : null;
  const parsed = parseMoveStatement(r1.statement);
  const moved = { v: 1, from: parsed.payload.from, to: parsed.payload.to, redirectBase: `${B}/bindle/portability/from/a.example/`, boundRedirectBase: `${B}/bindle/portability/from/a.example/`,
    statement: r1.statement, statementDigest: await statementDigest(parsed.input), attestation: r1.attestation, committedAt: now, redirectUntil: now + redirectDays * DAY, exportUntil: now + 30 * DAY, movedUntil: now + Math.max(redirectDays, 30) * DAY,
    ...thumbprints ? { destinationKeys: thumbprints } : {}, reminderEmail: { address: 'mover@mail.example', verifiedAt: now - 9 * DAY } };
  repository.rows.set(id.sub, { id: id.sub, handle: 'mover', status: 'moved', revision: 1, moved });
  const logs = [], due = [];
  const records = redirectRecordsPort(repository, { clock: clock.now });
  const client = portabilityClient({ fetch: world.net.fetch, clock: clock.now });
  const fx = { clock, world, hosts, id, r1, repository, records, logs, due, token: null };
  /** The fake sign-in: the transaction is the bound intent; the token is whatever the test set as `fx.token`. */
  const signin = {
    async begin({ identity, intent }) { fx.begun = { identity, intent }; return { authorizationUrl: `https://${identity.split('@')[1]}/oauth/authorize?entry=x`, transaction: JSON.stringify(intent) }; },
    async complete({ transaction }) { if (!fx.token) throw new Error('declined'); return { token: structuredClone(fx.token), intent: JSON.parse(transaction) }; },
  };
  fx.service = new RedirectManagementService({ records, client, signin, issuer: A, clock: clock.now, log: event => logs.push(event), due: { put: async (owner, at, kind) => { due.push({ owner, at, kind }); } } });
  fx.account = async () => repository.get(id.sub);
  fx.moved = async () => (await fx.account()).moved;
  /** Signs in as the identity at `provider` (its current identity URI there). */
  fx.signedInAt = (provider, extra = {}) => { fx.token = { issuer: provider.origin, subject: provider.state.get(id.sub).identity, client_id: `${A}/.well-known/bindle/redirect-manager`, ...extra }; return fx.token; };
  fx.run = async (action, redirectBase) => { const started = await fx.service.begin({ identity: 'mover@x.example', action, ...redirectBase !== undefined ? { redirectBase } : {} }); return fx.service.complete({ transaction: started.transaction, callback: 'https://a.example/transfer-manage?code=c&state=s&iss=x' }); };
  fx.headOf = async provider => { const moves = provider.state.get(id.sub).moves; return statementDigest(parseMoveStatement(moves.at(-1).statement).input); };
  return fx;
}
