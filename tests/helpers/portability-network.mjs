// Engine-level fixture for identity portability PORT-4/PORT-5: an in-memory network of simulated providers that speak
// the real wire formats (protocol §2 manifest, directory.v1 `?sub=`, identity documents with `moves`, the attestation
// JWKS and the move endpoint), with real ES256 statements, attestations and keys.mjs-format continuity statements.
//
//   createNetwork()                 -> {fetch, register(origin, handler), down:Set, calls}
//   new World({net, clock})         synthetic providers and identities for verifier (PORT-5) tests:
//     world.provider(origin, {portability, attestation})   a host with a P16 attestation key set
//     world.identity()               an identity (sub + signing key lineage)
//     world.host(provider, identity) hosts it there (status active)
//     world.move(identity, from, to, {attest, rotate, attestWith})  one move with both signatures (or unattested)
//     provider.rotateAttestation() / provider.lapse()      chained rotation / a lapsed domain's new root
import { base64url, textEncoder, canonical } from '../../packages/core/records.mjs';
import { signMoveStatement, signMoveAttestation, statementDigest, parseMoveStatement } from '../../packages/identity/succession.mjs';
import { createAttestationKeySet, rotateAttestationKeySet, parseAttestationKeySet, publishedAttestationJwks } from '../../packages/identity/attestation-keys.mjs';
import { MANIFEST_PATH } from '../../packages/identity/successors.mjs';

const ES = { name: 'ECDSA', hash: 'SHA-256' }, P = { name: 'ECDSA', namedCurve: 'P-256' };
export const json = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
export async function pair() { const keys = await crypto.subtle.generateKey(P, true, ['sign', 'verify']); const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', keys.publicKey); return { ...keys, publicJwk: { kty, crv, x, y }, privateJwk: await crypto.subtle.exportKey('jwk', keys.privateKey) }; }
/** packages/identity/keys.mjs continuity statement: `signer` (the predecessor) names `next`. */
export async function continuity(subject, signerKid, signer, next, at = Date.now()) {
  const payload = base64url(textEncoder.encode(canonical({ version: 1, subject, purpose: 'signing', previous: signerKid, signer: signerKid, next: { kid: next.kid, alg: 'ES256', publicJwk: next.publicJwk }, at })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign(ES, signer.privateKey, textEncoder.encode(`3sln-identity-key-continuity-v1.ES256.${signerKid}.${payload}`))));
  return { alg: 'ES256', kid: signerKid, payload, signature };
}

export function createNetwork() {
  const handlers = new Map(), down = new Set(), calls = [];
  return {
    down, calls, handlers,
    register(origin, handler) { handlers.set(origin, handler); },
    async fetch(href, init = {}) {
      const url = new URL(href); calls.push({ method: init.method ?? 'GET', url: href });
      if (down.has(url.origin)) throw new TypeError('network down');
      const handler = handlers.get(url.origin); if (!handler) throw new TypeError('no such host');
      if (init.redirect !== 'manual' || init.credentials !== 'omit') throw new Error('policy: redirects must be manual and credentials omitted');
      const response = await handler({ method: init.method ?? 'GET', url, path: url.pathname, query: url.search, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      return response ?? json({ error: 'not_found' }, 404);
    },
  };
}

/** A provider's standard routes over `state` (identities hosted there). `extra(request)` may answer first. */
export function providerHandler({ origin, state, jwks, portability = true, move, extra }) {
  return async request => {
    if (extra) { const answered = await extra(request); if (answered) return answered; }
    const { path, method } = request;
    if (path === MANIFEST_PATH && method === 'GET') return json({ version: '0', issuer: origin, features: { 'directory.v1': { directory_url: `${origin}/directory` }, ...portability ? { 'portability.v1': { move_endpoint: `${origin}/move`, attestation_jwks_uri: `${origin}/attestation-keys`, transfer_in_endpoint: `${origin}/transfer-in` } } : {} } });
    if (path === '/attestation-keys' && method === 'GET' && portability) return json(typeof jwks === 'function' ? jwks() : jwks);
    if (path === '/directory' && method === 'GET') {
      const sub = new URLSearchParams(request.query).get('sub'), entry = state.get(sub);
      if (!entry) return json({ error: 'not_found' }, 404);
      if (entry.status === 'active') return json({ iss: origin, sub, identity: entry.identity });
      if (entry.status === 'moved' && entry.moved) return json({ v: 1, iss: origin, sub, moved: entry.moved }, 308, { Location: `${entry.redirect ?? 'https://elsewhere.example/'}directory?sub=${sub}` });
      if (entry.status === 'redirect-only') return new Response(null, { status: 308, headers: { Location: entry.location } });
      return json({ error: 'not_found' }, 404);
    }
    if (path.endsWith('/identity.json') && method === 'GET') {
      const identity = `${origin}${path.slice(0, -'/identity.json'.length)}`;
      for (const [sub, entry] of state) if (entry.identity === identity) {
        if (entry.status === 'active') return json(typeof entry.document === 'function' ? await entry.document() : entry.document);
        if (entry.status === 'moved' && entry.moved) return json({ v: 1, iss: origin, sub, moved: entry.moved }, 308, { Location: `${entry.redirect ?? 'https://elsewhere.example/'}identity.json` });
        if (entry.status === 'redirect-only') return new Response(null, { status: 308, headers: { Location: entry.location } });
      }
      return json({ error: 'not_found' }, 404);
    }
    if (path === '/move' && method === 'POST' && move) return move(request.body);
    return null;
  };
}

class Provider {
  constructor(world, origin, { portability = true } = {}) { Object.assign(this, { world, origin, portability, state: new Map(), config: null }); }
  get set() { return parseAttestationKeySet(this.config); }
  async init() { this.config = await createAttestationKeySet({ kid: `${new URL(this.origin).hostname}-a1` }); this.world.net.register(this.origin, providerHandler({ origin: this.origin, state: this.state, jwks: () => publishedAttestationJwks(this.set), portability: this.portability, extra: request => this.extra?.(request) })); return this; }
  async rotateAttestation() { const n = this.set.keys.length + 1; this.config = await rotateAttestationKeySet(this.config, { kid: `${new URL(this.origin).hostname}-a${n}` }); }
  /** A lapsed domain: a new owner publishes a fresh root and none of the old keys (no private key to vouch with). */
  async lapse() { this.config = await createAttestationKeySet({ kid: `${new URL(this.origin).hostname}-lapsed` }); }
  async attest(payload, signerKid) {
    const set = this.set, entry = set.keys.find(key => key.kid === (signerKid ?? set.current));
    const privateKey = await crypto.subtle.importKey('jwk', { ...entry.publicJwk, d: entry.d ?? set.keys.find(key => key.kid === set.current).d }, P, false, ['sign']);
    return signMoveAttestation({ kid: entry.kid, payload }, privateKey);
  }
}

class Identity {
  constructor(sub) { this.sub = sub; this.keys = []; this.kind = 'person'; }
  get current() { return this.keys.at(-1); }
  async addKey({ rotate = true, at } = {}) {
    const key = await pair(), kid = `k${this.keys.length + 1}-${this.sub.slice(0, 4)}`, previous = this.current;
    const entry = { kid, use: 'sig', alg: 'ES256', jwk: key.publicJwk, state: 'active', created: Math.floor((at ?? Date.now()) / 1000), predecessor: null, continuity: null };
    if (previous && rotate) { entry.predecessor = previous.kid; entry.continuity = await continuity(this.sub, previous.kid, previous.pair, { kid, publicJwk: key.publicJwk }); previous.entry.state = 'retired'; previous.entry.retired = entry.created; }
    this.keys.push({ kid, pair: key, entry }); return this.keys.at(-1);
  }
  documentKeys() { return this.keys.map(key => ({ ...key.entry })); }
}

export class World {
  constructor({ net = createNetwork(), clock } = {}) { Object.assign(this, { net, clock, providers: new Map(), counter: 0 }); }
  async provider(origin, options) { const provider = await new Provider(this, origin, options).init(); this.providers.set(origin, provider); return provider; }
  async identity({ sub } = {}) { const value = sub ?? `6f1c2b8e-3d4a-4c5b-9e7f-${String(++this.counter).padStart(12, '0')}`; const identity = new Identity(value); await identity.addKey(); return identity; }
  identityURI(provider, identity, n = 1) { return `${provider.origin}/identity/${identity.sub}${n > 1 ? `/r${n}` : ''}`; }
  host(provider, identity, { moves = [], n = 1 } = {}) {
    // The host's own view of the keys, snapshotted now (a source that keeps serving after a fork keeps its view).
    const entry = { status: 'active', identity: this.identityURI(provider, identity, n), moves, keys: identity.documentKeys() };
    entry.document = () => ({ v: 1, iss: provider.origin, sub: identity.sub, kind: identity.kind, keys: entry.keys, ...entry.moves.length ? { moves: entry.moves } : {} });
    provider.state.set(identity.sub, entry); return entry;
  }
  /** One move from `from` to `to`. Returns the record. `attest:false` makes it unattested; `attestWith` signs with a
   * specific provider's attestation keys (a forger); `rotate` rotates at the destination (P11). */
  async move(identity, from, to, { attest = true, rotate = true, attestWith, iat, keepSource = false, redirect = true } = {}) {
    const source = from.state.get(identity.sub), moves = source?.moves ?? [], last = moves.at(-1);
    const n = [...to.state.values()].filter(entry => entry.identity.startsWith(`${to.origin}/identity/${identity.sub}`)).length + 1;
    const statement = await signMoveStatement({ kid: identity.current.kid, payload: { bindle: 'identity-move', v: 1, sub: identity.sub, kind: identity.kind, seq: moves.length + 1, prev: last ? await statementDigest(parseMoveStatement(last.statement).input) : null, from: { iss: from.origin, identity: source.identity }, to: { iss: to.origin, identity: this.identityURI(to, identity, n) }, iat: iat ?? Math.floor(Date.now() / 1000) } }, identity.current.pair.privateKey);
    const parsed = parseMoveStatement(statement);
    const attestation = attest ? await (attestWith ?? from).attest({ bindle: 'move-attestation', v: 1, iss: from.origin, sub: identity.sub, seq: parsed.payload.seq, statement: await statementDigest(parsed.input), to: parsed.payload.to, aep: 3 + moves.length, at: parsed.payload.iat + 10 }) : null;
    const record = { statement, attestation };
    if (!keepSource) { source.status = 'moved'; source.moved = record; source.redirect = redirect ? `${to.origin}/bindle/portability/from/${new URL(from.origin).host}/` : undefined; }
    if (rotate) await identity.addKey();
    this.host(to, identity, { moves: [...moves, record], n });
    return record;
  }
}
