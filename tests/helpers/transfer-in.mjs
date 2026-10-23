// Engine-level fixture for identity transfer-in (PORT-4): the REAL PORT-2 source (TransferOutService over
// tests/helpers/transfer-out.mjs, served through the real PORT-3 moved hooks) and the PORT-4 destination engine over its
// own account store, identity repository, key registry and attestation-key pins, joined by the simulated network of
// tests/helpers/portability-network.mjs. One clock drives both.
import { createTestEngine } from './app-engine.mjs';
import { transferFixture, ISSUER, DEST, OWNER, DAY, HOUR, MINUTE } from './transfer-out.mjs';
import { createNetwork, providerHandler, json } from './portability-network.mjs';
import { SqliteMetadata } from '../../apps/node/resources.mjs';
import { IdentityRepository } from '../../packages/runtime/accounts.mjs';
import { metadataStore } from '../../packages/app/memory-providers.mjs';
import { IdentityKeyRegistry } from '../../packages/identity/keys.mjs';
import { identityURI } from '../../packages/identity/transfer-out.mjs';
import { movedDirectoryResponse, movedIdentityDocument } from '../../packages/runtime/routes/moved.mjs';
import { parseAttestationKeySet, publishedAttestationJwks } from '../../packages/identity/attestation-keys.mjs';
import { portabilityClient, attestationPins, SuccessorRegistry } from '../../packages/identity/successors.mjs';
import { TransferInService, TransferInIntake, transferInIdentityPort, identityDocument, directoryAnswer, certificationKeys, TRANSFER_IN_KEY, BeginTransferIn, CancelTransferIn, StepTransferIn, TransferInStatus, CheckTransferIn, ReserveTransferIn } from '../../packages/identity/transfer-in.mjs';

export { ISSUER, DEST, OWNER, DAY, HOUR, MINUTE, TRANSFER_IN_KEY };
const random = { uuid: () => crypto.randomUUID(), bytes: n => crypto.getRandomValues(new Uint8Array(n)) };

/** The real source as a network host: manifest, directory and identity document while active (the moved hooks after
 * commit), the attestation JWKS of its configured key and the move endpoint over `transfer.statement`. */
export function serveSource(net, fx, { portability = true } = {}) {
  const env = { IDENTITY_REPOSITORY: fx.repository, APP_ORIGIN: ISSUER, MOVED_CLOCK: () => fx.clock.now() };
  const set = parseAttestationKeySet({ kid: 'att-1', jwk: fx.attestation.privateJwk });
  const sourceState = { moveDown: false, extra: null };
  net.register(ISSUER, providerHandler({ origin: ISSUER, state: new Map(), portability, jwks: () => publishedAttestationJwks(set),
    async move(body) {
      if (sourceState.moveDown) return json({ error: 'temporarily_unavailable' }, 503, { 'Retry-After': '60' });
      const result = await fx.statement({ statement: body.statement, transfer: body.transfer, redirect_base: body.redirect_base });
      if (result.status === 'attested') return json(result);
      if (result.status === 'pending') return json(result, 202);
      if (result.status === 'unavailable') return json({ error: 'temporarily_unavailable' }, 503);
      return json({ status: 'refused' }, 409);
    },
    async extra(request) {
      if (sourceState.extra) { const answered = await sourceState.extra(request); if (answered) return answered; }
      const account = await fx.repository.get(OWNER), identity = identityURI(ISSUER, OWNER);
      if (request.path === '/directory' && request.method === 'GET') {
        const sub = new URLSearchParams(request.query).get('sub'); if (sub !== OWNER) return json({ error: 'not_found' }, 404);
        if (account?.status === 'active') return json({ iss: ISSUER, sub, identity });
        return await movedDirectoryResponse(new Request(request.url.href), env, { sub }) ?? json({ error: 'not_found' }, 404);
      }
      if (request.path === `/identity/${OWNER}/identity.json` && request.method === 'GET') {
        if (account?.status === 'active') return json({ v: 1, iss: ISSUER, sub: OWNER, kind: 'person', keys: [{ kid: fx.state.currentKid, use: 'sig', alg: 'ES256', jwk: fx.signing.publicJwk, state: 'active', created: 1790000000, predecessor: null, continuity: null }] });
        return await movedIdentityDocument(new Request(request.url.href), env, OWNER) ?? json({ error: 'not_found' }, 404);
      }
      return null;
    } }));
  return sourceState;
}

/** The destination: TransferInService + TransferInIntake over fresh stores, published on the network as DEST. */
export async function destinationFixture(t, { net, clock, seed = 1, roots = {}, recovery } = {}) {
  const f = await createTestEngine({ seed, clock });
  const idDb = new SqliteMetadata(':memory:'), pinsDb = new SqliteMetadata(':memory:');
  const repository = new IdentityRepository({ metadata: idDb, config: {} }), identity = transferInIdentityPort(repository, { clock: clock.now });
  const registry = new IdentityKeyRegistry({ store: metadataStore(f.metadata), seal: value => structuredClone(value), open: value => structuredClone(value), clock: clock.now });
  const logs = [], client = portabilityClient({ fetch: net.fetch, clock: clock.now });
  const pins = attestationPins({ store: metadataStore(pinsDb), client, roots, clock: clock.now, log: event => logs.push(event) });
  const state = { flags: { enabled: true, background: true } };
  const keys = { import: (owner, input) => registry.importTransfer(owner, input), rotate: (owner, input) => registry.rotateAtActivation(owner, input), statementSigner: owner => registry.privateKey(owner, 'signing', { transferStatement: true }), destroy: owner => registry.destroyCustody(owner) };
  const ports = { issuer: DEST, identity, client, pins, keys, seal: value => structuredClone(value), ...recovery ? { recovery } : {} };
  const flags = { for: () => ({ enabled: () => state.flags.enabled, background: () => state.flags.background, global: () => state.flags.enabled }) };
  const service = new TransferInService({ executor: { metadata: f.metadata }, ports: () => ports, flags, clock, random, log: event => logs.push(event) });
  const intake = new TransferInIntake({ ports: () => ports, flags, clock, random });
  const engine = await createTestEngine({ seed, clock, providers: { lifecycle: service } }), intakeEngine = await createTestEngine({ seed, clock, providers: { lifecycle: intake } });
  t?.after?.(async () => { await engine.dispose(); await intakeEngine.dispose(); await f.dispose(); idDb.close(); pinsDb.close(); });
  await f.metadata.put('owner', OWNER);
  const document = async () => { const account = await identity.get(OWNER); return identityDocument({ issuer: DEST, identity: account, signing: await registry.history(OWNER, { purpose: 'signing' }), certification: await certificationKeys(f.metadata, OWNER) }); };
  const destState = new Map();
  net.register(DEST, providerHandler({ origin: DEST, state: destState, jwks: { keys: [] }, async extra(request) {
    const account = await identity.get(OWNER).catch(() => null);
    if (request.path === '/directory') { const answer = directoryAnswer({ issuer: DEST, identity: account }); return new URLSearchParams(request.query).get('sub') === OWNER && answer ? json(answer) : json({ error: 'not_found' }, 404); }
    if (request.path === `/identity/${OWNER}/identity.json`) { const doc = await document(); return doc ? json(doc) : json({ error: 'not_found' }, 404); }
    return null;
  } }));
  return { f, metadata: f.metadata, repository, identity, registry, client, pins, ports, flags, state, service, intake, engine, intakeEngine, logs, document,
    get: () => f.metadata.get(TRANSFER_IN_KEY), identityRecord: () => repository.get(OWNER),
    check: (pkg, source = 'package') => intakeEngine.perform(new CheckTransferIn({ actor: { kind: 'intake' }, input: { package: pkg, source } })),
    reserve: (pkg, source = 'package') => intakeEngine.perform(new ReserveTransferIn({ actor: { kind: 'intake' }, input: { package: pkg, source } })),
    begin: (pkg, source = 'package', actor = { kind: 'owner', owner: OWNER }) => engine.perform(new BeginTransferIn({ actor, input: { package: pkg, source } })),
    step: () => engine.perform(new StepTransferIn({ actor: { kind: 'system', owner: OWNER } })),
    cancel: () => engine.perform(new CancelTransferIn({ actor: { kind: 'owner', owner: OWNER } })),
    status: () => engine.read(new TransferInStatus({ actor: { kind: 'owner', owner: OWNER } })),
  };
}

/** The portable package the source's isolated page builds from the current file (§9.1), with the pending transfer. */
export function packageFrom(fx, record, overrides = {}) {
  return { bindle: 'identity-package', v: 1, sub: OWNER, kind: 'person', from: { iss: ISSUER, identity: identityURI(ISSUER, OWNER) }, keys: { signing: { kid: fx.state.currentKid, jwk: fx.signing.privateJwk } }, ...record?.transfer ? { transfer: { id: record.transfer.id, exp: record.transfer.exp } } : {}, ...overrides };
}

/** Source + destination + network. `start`: authorize the move at the source (path (a)). */
export async function portabilityPair(t, { seed = 1, roots, recovery, start = true } = {}) {
  const source = await transferFixture(t, { seed });
  const net = createNetwork(), served = serveSource(net, source);
  const dest = await destinationFixture(t, { net, clock: source.clock, seed, roots, recovery });
  let record = null;
  if (start) { await source.start(); record = await source.get(); }
  const verifiers = [];
  const verifier = ({ enabled = true, roots: verifierRoots = {} } = {}) => { const db = new SqliteMetadata(':memory:'); t?.after?.(() => db.close()); const registry = new SuccessorRegistry({ store: metadataStore(db), client: portabilityClient({ fetch: net.fetch, clock: source.clock.now }), enabled: () => enabled, roots: verifierRoots, clock: source.clock.now }); verifiers.push(registry); return registry; };
  return { source, dest, net, served, record, pkg: packageFrom(source, record), clock: source.clock, verifier };
}
