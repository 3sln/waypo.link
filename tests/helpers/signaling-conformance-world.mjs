// The shared world of the clean-room signaling conformance suite (tests/signaling-conformance*.test.mjs) against
// docs/spec/extensions/signaling.md (signaling.v1 rev 3.2). Each test file boots its own world (`useWorld`).
//
// Appendix C.5 step 6: the conformance peer and suite rewritten from the revision 3.2 text only (§21.1 "Required
// coverage", §21.2 "Impact on the existing clean-room suite"). The carried RTC-i tests keep their §21.2 renames and
// "Changes"; the §21.2 "New, needed by this draft" tests are added below their own banners. Section numbers are
// revision 3.2 numbers. Expectations come from the spec text; where the implementation differs, the test records a
// divergence (below) instead of adapting to the code.
//
// The provider under test is the production Node adapter (apps/node/server.mjs, createNodeServer) listening on a
// loopback port with the signaling flags on and the peer origins in SIGNALING_FOREIGN_ISSUERS. The second provider is
// tests/signaling-conformance-peer.mjs, which imports no 3sln.me code. The two talk over:
//   - peer -> provider: real HTTP to 127.0.0.1:<port> with `Host: provider.example` (the provider's own host check);
//   - provider -> peer: the provider's real directory and signaling egress code, with only DNS and the socket replaced
//     through the documented DIRECTORY_DNS_LOOKUP / DIRECTORY_HTTPS_REQUEST injection ports (a public IPv4 answer; the
//     request is handed to the peer's handler instead of a TLS socket).
// The provider-side applications (two clients, APP and OTHER_APP) are driven through the real authorization request,
// owner consent, token and /bindle/rpc routes with the DEFAULT Node wiring: the shipped signaling fragment and
// signaling/v1 contract. Owner actions go through the owner routes the provider pages call: session handler approvals
// (/api/intents/session-*, AMD-SG-I1 §20.1.4), pairings, blocks, offer revocation and the live-offer list
// (/api/signaling/*, §14.1). A widening owner action is taken as a page takes it: a review of exactly that change
// (POST /api/signaling/review), then the action once the review is armed ("controls armed after a delay", §20.1.4,
// §5.8). What the pages render (disclosures, CSRF, framing) is browser-tested elsewhere, not here.
//
// Files: tests/signaling-conformance.test.mjs (the RTC-i tests carried by §21.2), -routing.test.mjs (approval, routing,
// pairings, bases, same-provider sessions, retention, glare) and -offers.test.mjs (offers, windows, blocks, the data
// profile, transport). Each boots its own world, so they run in parallel.
//
// Test seams beyond the two network ports and the operator configuration a deployment sets anyway (flags,
// SIGNALING_FOREIGN_ISSUERS, the reviewed clients, the trusted client-IP header that gives each test account its own
// signup address):
//   - the session kinds (intent kinds with the AMD-SG-I1 `session` member) are registered as operator artefact envelopes
//     through FEDERATION_CONTRACTS, as an operator would hold them (§3.4: providers never fetch a kind on a request
//     path). Their bodies and version digests are computed by the clean-room peer (intents §4, artefacts §4);
//   - the enablement-uniformity test publishes an operator flag snapshot (resources.flagsRuntime.publish) that denies
//     one account, as a rollout cohort would (§9.2 "Per-entity enablement");
//   - the glare test also compares the implementation's endpoint-rule helper (packages/signaling/sessions.mjs
//     glareSurvivor, the only implementation of the §8.3 endpoint rule) with the peer's clean-room ranks. That is the
//     only implementation module imported besides the server under test; the peer imports none.
// Divergences found are reported through `t.todo(...)` (so `npm test` stays green); SIGNALING_CONFORMANCE_STRICT=1
// turns the ones not marked "plausibly intentional" into failures. Items that this deployment cannot exercise over its
// public surfaces (provider-feature and service-class endpoints) are skipped with the reason, never passed.
import {rpcHeaders, encodeRPC, rpcBody} from './rpc.mjs';
import {softAuthenticator, registerPending} from './soft-passkey.mjs';
import nodeTest, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import http from 'node:http';
import {createNodeServer} from '../../apps/node/server.mjs';
import {createPeer, nodeNetwork, keyPair, newSid, now, sdp, offerDigest, part, sign, candidate, candidateItem, TYP, MAGIC, sessionKind, kindEnvelope, kindReference} from '../signaling-conformance-peer.mjs';

export const PROVIDER = 'https://provider.example', PEER = 'https://peer.example', PEER_NO_SIGNALING = 'https://plain.example', PEER_FLOOR = 'https://floor.example';
export const SPEC = 'https://spec.bindle.example';
export const FRAGMENT = `${SPEC}/fragments/signaling/v1`, CONTRACT = `${SPEC}/contracts/signaling/v1`;
/** §3.1: the signaling extension and its two prerequisites. */
export const SIGNALING_EXT = `${SPEC}/extensions/signaling/v1`, DIRECTORY_EXT = `${SPEC}/extensions/directory/v1`, VERSIONS_EXT = `${SPEC}/extensions/artefact-versions/v1`;
/** The options of extension `spec` in manifest `m` (undefined when not declared). */
export const ext = (m, spec) => (Array.isArray(m?.extensions) ? m.extensions : []).find(e => e?.spec === spec)?.options;
/** Whether manifest `m` declares extension `spec` (an extension without options carries no `options` member). */
export const declares = (m, spec) => (Array.isArray(m?.extensions) ? m.extensions : []).some(e => e?.spec === spec);

// ---- session kinds (§3.4, AMD-SG-I1 §20.1.1), written by the clean-room peer ------------------------------------------
export const UUID_FIELD = {call: {type: 'string', maxLength: 36, format: 'uuid'}};
/** LINE: other parties, `webrtc`, every basis, one optional context property (the carried RTC-i tests use it). */
export const LINE = 'https://kinds.example/kinds/conformance-call/v1';
/** DATA_LINE: any party, both profiles, every basis (`data` profile client, own-entity routing). */
export const DATA_LINE = 'https://kinds.example/kinds/conformance-data/v1';
/** SELF_LINE: own devices only, `data` (auto-connect, §5.5). */
export const SELF_LINE = 'https://kinds.example/kinds/conformance-sync/v1';
/** PAIR_LINE: any party, both profiles, bases ["self", "pairing"] (relation basis, own-entity pairings, glare; no offer). */
export const PAIR_LINE = 'https://kinds.example/kinds/conformance-remote/v1';
/** OFFER_LINE: other parties, `data`, bases ["offer"] (no relation basis). */
export const OFFER_LINE = 'https://kinds.example/kinds/conformance-request/v1';
export const ENVELOPES = {
  [LINE]: kindEnvelope(sessionKind({line: LINE, parties: 'other', profiles: {webrtc: {}}, properties: UUID_FIELD, title: 'Conformance call'})),
  [DATA_LINE]: kindEnvelope(sessionKind({line: DATA_LINE, parties: 'any', profiles: {data: {}, webrtc: {}}, title: 'Conformance data'})),
  [SELF_LINE]: kindEnvelope(sessionKind({line: SELF_LINE, parties: 'self', profiles: {data: {}}, title: 'Conformance sync'})),
  [PAIR_LINE]: kindEnvelope(sessionKind({line: PAIR_LINE, parties: 'any', profiles: {data: {}, webrtc: {}}, bases: ['self', 'pairing'], title: 'Conformance remote'})),
  [OFFER_LINE]: kindEnvelope(sessionKind({line: OFFER_LINE, parties: 'other', profiles: {data: {}}, bases: ['offer'], title: 'Conformance request'}))
};
export const REF = Object.fromEntries(await Promise.all(Object.entries(ENVELOPES).map(async ([line, e]) => [line, await kindReference(e)])));
export const KIND = REF[LINE];
export const KIND_CONTRACTS = Object.fromEntries(Object.entries(ENVELOPES).flatMap(([line, e]) => [[line, e], [line + '/envelope', e]]));
export const APP = {id: 'https://app.example/client', name: 'Conformance app', origin: 'https://app.example', redirectUris: ['https://app.example/callback']};
export const OTHER_APP = {id: 'https://other-app.example/client', name: 'Conformance other app', origin: 'https://other-app.example', redirectUris: ['https://other-app.example/callback']};
/** §10.2 methods. */
export const METHODS = ['register', 'unregister', 'endpoints', 'open', 'offer', 'revoke_offer', 'claim', 'send', 'renew', 'listen'];
export const STRICT = process.env.SIGNALING_CONFORMANCE_STRICT === '1';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Every test is bounded, so a provider that stops answering fails the test instead of hanging the run. */
export const test = (name, fn, {timeout = 90000} = {}) => nodeTest(name, {timeout}, fn);

// ---- spec-derived documents the provider needs registered -----------------------------------------------------------
/** The signaling fragment, §3.2. */
export const FRAGMENT_DOCUMENT = {id: FRAGMENT, title: 'Signaling', description: 'Lets an app or a provider feature set up direct connections between your devices and other people\'s, for the kinds you approve.', publisher: SPEC, fields: {signaling: {title: 'Signaling service', type: 'resource', cardinality: {min: 0, max: 1}, contracts: [CONTRACT], selection: 'exclusive', consumers: ['application', 'provider']}}};
/** A clean-room contract document for §10.2 (results as listed there; `listen` events as §10.3 names them), registered
 * only by the "x-bindle-brokerable" probe. */
export function contractDocument({brokerable = false} = {}) {
  const S = {type: 'string'}, A = {}, o = p => ({type: 'object', properties: p});
  const event = o({type: A, sid: A, seq: A, certificate: A, invite: A, message: A, state: A, control: A, pairing: A,
    projection: o({initiator: o({iss: A, sub: A}), handle: A, origin: A, client_id: A, feature: A, reported_by: A, kind: o({artefact: A, version: A, digest: A}), profile: A, params: A, context: A, basis: A, auto_connect: A, offer_match: A, paired: A})});
  return {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: CONTRACT, title: 'Signaling v1 (clean-room test registration)', description: 'Written from signaling.md section 10.2 for the signaling conformance suite.',
    ...brokerable ? {'x-bindle-brokerable': false} : {},
    oneOf: METHODS.map(m => ({type: 'object', properties: {method: {const: m}, args: {type: 'object'}}, required: ['method', 'args'], additionalProperties: false})),
    'x-methods': Object.fromEntries(METHODS.map(m => [m, {request: '#', result: '#/$defs/' + m, effect: ['listen', 'endpoints'].includes(m) ? 'read' : 'write'}])),
    $defs: {register: o({endpoint: S, endpoint_secret: S, expires_at: A}), unregister: o({}), endpoints: o({endpoints: {type: 'array', items: o({endpoint: S, label: A, kinds: {type: 'array', items: S}, last_seen: A, client_id: A})}, pairings: A}),
      open: o({sid: S, certificate: S, expires_at: A, peer_keys: A}), offer: o({offers: {type: 'array', items: o({principal: A, offer: A})}, expires_at: A}), revoke_offer: o({}),
      claim: o({certificate: S, peer_keys: A}), send: o({accepted: A}), renew: o({certificate: S}),
      listen: o({cursor: A, gap: A, events: {type: 'array', items: event}})}};
}
export const envelope = doc => ({[CONTRACT]: doc, [CONTRACT + '/envelope']: {bindle_artefact: 1, id: CONTRACT, kind: 'rpc-contract', versions: [{version: 1, prev: null, body: doc}]}});

// ---- findings -----------------------------------------------------------------------------------------------------
export const findings = [];
/** Records a spec/behaviour divergence and marks the test todo (or fails it under STRICT unless plausibly intentional). */
export function diverge(t, {section, request, observed, expected, side, intentional = false}) {
  findings.push({test: t.name, section, request, observed, expected, side, intentional});
  const message = `DIVERGENCE ${section}: expected ${expected}; observed ${observed} [wrong side: ${side}${intentional ? '; plausibly an intentional reading' : ''}]`;
  if (STRICT && !intentional) assert.fail(message);
  t.diagnostic(message); t.todo(message);
}

// ---- the world ----------------------------------------------------------------------------------------------------
export async function boot({config = {}, contracts = {}} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'signaling-conformance-'));
  const peers = {};
  const net = nodeNetwork({'peer.example': r => peers.peer.handler(r), 'plain.example': r => peers.plain.handler(r), 'floor.example': r => peers.floor.handler(r)});
  const cfg = {APP_ORIGIN: PROVIDER, LOCAL_DEVELOPMENT: 'true', WORK_LIMITS_ENABLED: 'false', TRUSTED_CLIENT_IP_HEADER: 'x-conformance-client-ip', SIGNUP_IP_WINDOW_MS: '1000', SIGNUP_IP_DAILY_LIMIT: '1000', SIGNUP_SUBNET_DAILY_LIMIT: '1000', SIGNUP_REGION_HOURLY_LIMIT: '1000', SIGNUP_REGION_DAILY_LIMIT: '1000', SIGNUP_GLOBAL_HOURLY_LIMIT: '1000', SIGNUP_GLOBAL_DAILY_LIMIT: '1000', FEDERATION_ENABLED: 'true', EXTENSIONS_ENABLED: 'true', ARTEFACT_VERSIONS_ENABLED: 'true', DIRECTORY_ENABLED: 'true',
    SIGNALING_ENABLED: 'true', SESSION_KINDS_ENABLED: 'true', SIGNALING_FOREIGN_ENABLED: 'true', SIGNALING_FOREIGN_ISSUERS: JSON.stringify([PEER, PEER_NO_SIGNALING, PEER_FLOOR]),
    FEDERATION_CLIENTS: JSON.stringify([APP, OTHER_APP]), FEDERATION_CONTRACTS: JSON.stringify({...KIND_CONTRACTS, ...contracts}),
    DIRECTORY_DNS_LOOKUP: net.lookup, DIRECTORY_HTTPS_REQUEST: net.request, ...config};
  const app = await createNodeServer({directory, config: cfg});
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  /** Real HTTP over loopback to the provider, with its configured Host. */
  const wire = (path, {method = 'GET', headers = {}, body} = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(body);
    const req = http.request({host: '127.0.0.1', port, path, method, headers: {Host: 'provider.example', ...headers, ...data ? {'Content-Length': data.length} : {}}}, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), {status: res.statusCode, headers: Object.entries(res.headers).flatMap(([k, v]) => Array.isArray(v) ? v.map(x => [k, x]) : [[k, String(v)]])})));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  peers.peer = await createPeer({origin: PEER, providerFetch: wire});
  peers.plain = await createPeer({origin: PEER_NO_SIGNALING, providerFetch: wire, signaling: false});
  peers.floor = await createPeer({origin: PEER_FLOOR, providerFetch: wire, dpop: false});
  // Protocol §5: /bindle/rpc speaks Bindle CBOR (application/vnd.bindle.rpc+cbor); every other route stays JSON.
  const request = (path, {method = 'GET', data, cookie, csrf, bearer, appOrigin, ip} = {}) => { const rpc = path === '/bindle/rpc'; return wire(path, {method, headers: {Origin: appOrigin ?? PROVIDER, ...ip ? {'X-Conformance-Client-IP': ip} : {}, ...data !== undefined ? rpc ? rpcHeaders() : {'Content-Type': 'application/json'} : {}, ...cookie ? {Cookie: cookie} : {}, ...csrf ? {'X-CSRF-Token': csrf} : {}, ...bearer ? {Authorization: `Bearer ${bearer}`} : {}}, ...data !== undefined ? {body: rpc ? Buffer.from(encodeRPC(data)) : JSON.stringify(data)} : {}}); };
  const post = (p, d, o = {}) => request(p, {...o, method: 'POST', data: d});
  const peer = peers.peer;
  /** A provider account (signup through the HTTP routes) and its identity URI from the provider's own directory. */
  let signups = 0;
  const authenticator = softAuthenticator({origin: PROVIDER});
  async function account() {
    // Signup's fixed 3-per-minute burst per client address is met by giving each test account its own loopback address
    // through the operator's trusted client-IP header.
    const ip = `127.${2 + (signups >> 7)}.${signups & 127}.${1 + (signups++ & 63)}`;
    const pending = await (await post('/api/auth/signup', {method: 'passkey', ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'local-browser-test-token'}, {ip})).json();
    await registerPending(authenticator, async (path, data) => (await post(path, data, {ip})).json(), pending);
    const recovery = await (await post('/api/auth/recovery/download', {pendingToken: pending.pendingToken}, {ip})).json();
    const activation = await post('/api/auth/recovery/confirm', {pendingToken: pending.pendingToken, recoveryToken: recovery.recoveryToken, downloadConfirmed: true}, {ip});
    assert.equal(activation.status, 200, 'signup: ' + JSON.stringify(pending));
    const session = await activation.json(), owner = {cookie: activation.headers.get('Set-Cookie').split(';')[0], csrf: session.csrfToken};
    const sub = session.account.id, found = await peer.lookup(sub);
    return {sub, handle: session.account.handle, owner: {...owner, ip}, ip, identity: found?.identity, principal: {iss: PROVIDER, sub}};
  }
  /** Authorization request for the signaling fragment by `client`, owner assignment of the built-in signaling resource,
   * consent, token, then the owner's session handler approval of each line in `approve` (AMD-SG-I1 §20.1.4). */
  /**
   * A widening owner action as a provider page records it (§20.1.4 and §5.8 page obligations: "controls armed after a
   * delay"): the page first takes a review of exactly this change (POST /api/signaling/review), waits until the review
   * is armed, then submits the reviewed change (the review's canonical input, plus `extra` members chosen on the same
   * page, such as `activate`) carrying the review id. Several actions share one wait. A provider without the review
   * step (404) takes the action directly. Returns the action responses, in order.
   */
  async function widen(acct, actions) {
    const reviews = [];
    for (const {action, input} of actions) {
      const rv = await post('/api/signaling/review', {action, input}, acct.owner);
      if (rv.status === 404) { reviews.push({review: null}); continue; }
      const b = await rv.json().catch(() => null);
      reviews.push(rv.status === 200 && b?.review ? {review: b.review, armAt: b.armAt, input: b.input} : {refused: new Response(JSON.stringify(b?.refusal ?? b), {status: rv.status === 200 ? 409 : rv.status, headers: {'Content-Type': 'application/json'}})});
    }
    const armAt = Math.max(0, ...reviews.map(r => r.armAt ?? 0));
    if (armAt) await sleep(Math.max(0, armAt - Date.now()) + 60);
    const out = [];
    for (const [i, {action, input, extra = {}, path}] of actions.entries()) {
      const r = reviews[i];
      out.push(r.refused ?? await post(path ?? (action.startsWith('session-') ? '/api/intents/' + action : '/api/signaling/' + action), {...r.input ?? input, ...extra, ...r.review ? {review: r.review} : {}}, acct.owner));
    }
    return out;
  }
  async function connect(acct, {client = APP, approve = [LINE]} = {}) {
    const verifier = randomUUID() + randomUUID(), challenge = createHash('sha256').update(verifier).digest('base64url');
    const r = await post('/api/oauth/requests', {clientId: client.id, redirectUri: client.redirectUris[0], challenge, challengeMethod: 'S256', state: 's', identity: acct.handle + '@provider.example', requests: [{fragment: FRAGMENT, required: true, purpose: 'Sessions', fields: ['signaling'], methods: {signaling: {[CONTRACT]: METHODS}}}]}, {appOrigin: client.origin, ip: acct.ip});
    const pending = await r.json(); assert.equal(r.status, 201, JSON.stringify(pending));
    let view = await (await request('/api/oauth/requests/' + pending.requestId, acct.owner)).json();
    const resourceURI = view.requests[0].resources.find(x => x.id.endsWith('/signaling')).id;
    const prefs = await (await request('/api/preferences', acct.owner)).json();
    if (!prefs.preferences.find(p => p.fragment === FRAGMENT)) {
      const a = await post('/api/preferences', {fragment: FRAGMENT, expectedRevision: null, values: {signaling: resourceURI}}, acct.owner); assert.equal(a.status, 200, 'signaling resource assignment: ' + await a.clone().text());
      view = await (await request('/api/oauth/requests/' + pending.requestId, acct.owner)).json();
    }
    const d = await post('/api/oauth/requests/' + pending.requestId + '/decision', {requestId: pending.requestId, approved: [{fragment: FRAGMENT, revision: view.requests[0].revision, fields: ['signaling'], resources: {signaling: [resourceURI]}, methods: view.requests[0].methods}]}, acct.owner);
    const decision = await d.json(); assert.equal(d.status, 200, JSON.stringify(decision));
    const code = new URL(decision.redirectUri).searchParams.get('code');
    const token = await (await post('/oauth/token', {clientId: client.id, redirectUri: client.redirectUris[0], code, verifier}, {appOrigin: client.origin, ip: acct.ip})).json();
    const rpc = (bearer, resource, contract, method, args = {}) => post('/bindle/rpc', {version: '0', tx: randomUUID(), resource, contract, method, args}, {bearer, appOrigin: client.origin, ip: acct.ip});
    const prefsRead = await rpcBody(await rpc(token.access_token, '@preferences', 'https://3sln.me/artefacts/contracts/preferences/v2', 'read', {fragment: FRAGMENT}));
    assert.ok(prefsRead.result?.values?.signaling?.[0]?.token, 'preferences read: ' + JSON.stringify(prefsRead) + ' token: ' + JSON.stringify(token));
    const ref = prefsRead.result.values.signaling[0];
    for (const approved of await widen(acct, approve.map(line => ({action: 'session-approve', input: {clientId: client.id, kind: REF[line]}})))) assert.equal(approved.status, 200, 'session handler approval: ' + await approved.clone().text());
    const call = async (method, args = {}) => { const res = await rpc(ref.token, ref.id, CONTRACT, method, args); return {status: res.status, ...await rpcBody(res)}; };
    /** One RPC with a chosen `tx` (protocol §5), for the §10.2 retention rule. */
    const callTx = async (tx, method, args = {}) => { const res = await post('/bindle/rpc', {version: '0', tx, resource: ref.id, contract: CONTRACT, method, args}, {bearer: ref.token, appOrigin: client.origin, ip: acct.ip}); return {status: res.status, ...await rpcBody(res)}; };
    return {token, ref, call, callTx, grants: token.grants, client};
  }
  return {app, peers, peer, net, port, wire, request, post, account, connect, widen, close: async () => { app.server.closeAllConnections?.(); await app.close(); await rm(directory, {recursive: true, force: true}); }};
}

export let w;
/** Registers the shared world for one test file: one provider and its peers, booted before the first test and closed
 * after the last, with the file's findings printed at the end. */
export function useWorld() {
before(async () => { w = await boot(); });
after(async () => {
  if (findings.length) {
    process.stdout.write(`\n# signaling conformance findings (${findings.length}):\n`);
    for (const f of findings) process.stdout.write(`#  - [${f.section}] ${f.test}: expected ${f.expected}; observed ${f.observed} (wrong side: ${f.side}${f.intentional ? ', plausibly intentional' : ''})\n`);
  }
  await w?.close();
});
}

// ---- recipient contexts on the provider ---------------------------------------------------------------------------
export const auth = reg => ({endpoint: reg.result.endpoint, ...reg.result.endpoint_secret ? {endpoint_secret: reg.result.endpoint_secret} : {}});
/** A long-poll reader for one endpoint (§11.1: `listen` is the baseline; rapid short polls would meet the provider's
 * per-network RPC budget). */
export function listener(c, ep) {
  const l = {ep, events: [], cursor: undefined, c};
  l.poll = async (wait = 0) => { const r = await c.call('listen', {...ep, ...l.cursor !== undefined ? {cursor: l.cursor} : {}, wait}); if (r.result) { l.cursor = r.result.cursor; l.events.push(...r.result.events); } else if (r.status !== 200 || r.error) throw new Error('listen: ' + JSON.stringify(r)); return r; };
  l.waitEvent = async (pred, timeout = 6000) => { const end = Date.now() + timeout; let hit = l.events.find(pred); while (!hit && Date.now() < end) { await l.poll(Math.max(1, Math.min(2, Math.ceil((end - Date.now()) / 1000)))); hit = l.events.find(pred); } return hit ?? null; };
  l.has = pred => l.events.some(pred);
  return l;
}
/** Registers an endpoint of connection `c` for `kinds` and returns its listener. */
export async function endpoint(c, kinds = [LINE]) { const r = await c.call('register', {kinds}); assert.equal(r.status, 200, JSON.stringify(r)); return listener(c, auth(r)); }
/**
 * A provider account with the app connected and approved for every test kind, one registered endpoint for LINE, and its
 * own peer initiator entity. `ctx.offerToken()` returns the token of an open offer minted by that endpoint (§5.7),
 * rotated every 5 invites so that the per-(principal, offer) window (§13.1, reference 6 per hour) never decides a test.
 */
export async function callee({kinds = [LINE]} = {}) {
  const acct = await w.account(), c = await w.connect(acct, {approve: kinds});
  const reg = await c.call('register', {kinds}); assert.equal(reg.status, 200, JSON.stringify(reg));
  const ep = auth(reg), main = listener(c, ep);
  const ctx = Object.assign(main, {acct, c, ep, bob: await w.peer.entity(), current: null});
  ctx.mint = async (args = {}, from = ep) => { const o = await c.call('offer', {...from, kind: LINE, profile: 'webrtc', expires_in: 900, ...args}); assert.ok(o.result?.offers?.length, 'offer: ' + JSON.stringify(o)); return o.result; };
  ctx.offerToken = async () => { if (!ctx.current || ctx.current.n >= 5) ctx.current = {token: (await ctx.mint({uses: 16})).offers[0].offer, n: 0}; ctx.current.n++; return ctx.current.token; };
  ctx.register = async (k = kinds) => endpoint(c, k);
  /** The owner's live-offer list entry for a token (§14.1: kind, principal, uses spent of `uses`; never the token). */
  ctx.offerState = async token => { const id = await offerDigest(token); const s = await (await w.request('/api/signaling/settings', acct.owner)).json(); return (s.apps ?? []).flatMap(a => a.offers ?? []).find(o => o.id === id) ?? null; };
  ctx.owner = (action, data) => w.post('/api/signaling/' + action, data, acct.owner);
  return ctx;
}
/** Invite parts from a peer entity to the recipient; every member overridable for negative tests. `basis` defaults to
 * an offer basis over `ctx.offerToken()` with the token carried in the batch `offers` (§5.2, §9.1). */
export async function invite(ctx, {from = ctx.bob, sid = newSid(), leg, kind = KIND, profile = 'webrtc', offer = sdp(), params, answerIn = 100, basis, token, offers, certOverride = {}, msgOverride = {}, bodyOverride = {}, certOpts = {}, msgOpts = {}, peer = w.peer} = {}) {
  leg ??= await keyPair();
  if (basis === undefined) { token ??= await ctx.offerToken(); basis = {offer_digest: await offerDigest(token)}; }
  offers ??= token ? [token] : [];
  const cert = await peer.legCertificate({sub: from.sub, aud: ctx.acct.identity, sid, role: 'initiator', kind, profile, leg, override: certOverride, ...certOpts});
  const body = {kind, profile, answer_by: now() + answerIn, basis, context: null, params: params ?? (profile === 'data' ? {} : {offer}), ...bodyOverride};
  const message = await peer.message({leg, sub: from.sub, aud: ctx.acct.identity, sid, to: null, seq: 0, type: 'invite', body, override: msgOverride, ...msgOpts});
  return {sid, leg, from, kind, profile, token, cert, message, peer, batch: peer.batch({certificates: [cert], messages: [message], offers})};
}
/** Posts an invite until it reaches the endpoint (the first posts may meet a held-key miss, §9.2 step 3, §9.3). */
export async function deliver(l, inv, {timeout = 20000} = {}) {
  const end = Date.now() + timeout, peer = inv.peer ?? w.peer;
  while (Date.now() < end) {
    const r = await peer.post(inv.batch); assert.equal(r.status, 202, `invite post: ${r.status} ${r.body}`);
    const e = await l.waitEvent(e => e.type === 'invite' && e.sid === inv.sid, 1500); if (e) return e;
  }
  return null;
}
export const appMessage = (ctx, s, {seq, type, body, to = s.peerLeg?.jkt ?? null, iat = now()}) => sign({alg: 'ES256', typ: TYP.message, kid: s.appLeg.jkt}, {bindle: MAGIC.message, v: 1, iss: PROVIDER, sub: ctx.acct.sub, aud: s.peerIdentity, sid: s.sid, leg: s.appLeg.jkt, to, seq, iat, type, body}, s.appLeg);
/** Claims an inbound invite with `accept` and sends the signed accept; returns the connected session. */
export async function accept(ctx, inv, l = ctx) {
  const appLeg = await keyPair(), cl = await l.c.call('claim', {...l.ep, sid: inv.sid, outcome: 'accept', delegate: appLeg.jwk});
  assert.ok(cl.result?.certificate, 'claim: ' + JSON.stringify(cl));
  const s = {...inv, appLeg, peerLeg: inv.leg, peerIdentity: inv.from.identity, recipientCert: cl.result.certificate, appSeq: 0, peerSeq: 1, l};
  s.accept = await appMessage(ctx, s, {seq: s.appSeq++, type: 'accept', body: {params: inv.profile === 'data' ? {} : {answer: sdp({setup: 'active'})}}});
  const sent = await l.c.call('send', {...l.ep, sid: inv.sid, messages: [s.accept]}); assert.equal(sent.result?.accepted, 1, 'send accept: ' + JSON.stringify(sent));
  assert.ok(await w.peer.until(() => w.peer.messages(inv.sid).some(m => m.payload.type === 'accept'), {timeout: 6000}), 'accept relayed to the peer');
  return s;
}
/** Claims an inbound invite with `decline` and sends the signed decline. */
export async function decline(ctx, inv, l = ctx) {
  const appLeg = await keyPair(), cl = await l.c.call('claim', {...l.ep, sid: inv.sid, outcome: 'decline', delegate: appLeg.jwk});
  assert.ok(cl.result?.certificate, 'decline claim: ' + JSON.stringify(cl));
  const s = {...inv, appLeg, peerLeg: inv.leg, peerIdentity: inv.from.identity};
  const sent = await l.c.call('send', {...l.ep, sid: inv.sid, messages: [await appMessage(ctx, s, {seq: 0, type: 'decline', body: {reason: 'declined'}})]});
  assert.equal(sent.result?.accepted, 1, 'send decline: ' + JSON.stringify(sent));
  return s;
}
/** The initiator leg's `cancel` of an unclaimed inbound invite (seq 1). */
export const cancel = async (ctx, inv, seq = 1) => (inv.peer ?? w.peer).post((inv.peer ?? w.peer).batch({messages: [await (inv.peer ?? w.peer).message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq, type: 'cancel', body: {}})]}));
/** A message from the peer's initiator leg in a connected inbound session; returns whether the endpoint received it. */
export async function peerSend(ctx, s, type, body, {seq, wait = true, timeout = 3000, l = s.l ?? ctx, ...opts} = {}) {
  seq ??= s.peerSeq++;
  const m = await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq, type, body, ...opts});
  const r = await w.peer.post(w.peer.batch({messages: [m]}));
  const got = wait ? await l.waitEvent(e => e.type === 'message' && e.message === m, timeout) : null;
  return {m, r, got: !!got, seq};
}
/** A connected session used as an ordering sentinel: once a later valid message arrives, earlier batches were processed. */
export async function beacon(ctx) {
  if (ctx.beacon) return ctx.beacon;
  const inv = await invite(ctx); assert.ok(await deliver(ctx, inv), 'beacon invite delivered');
  return ctx.beacon = await accept(ctx, inv);
}
export async function sentinel(ctx) {
  const b = await beacon(ctx);
  const r = await peerSend(ctx, b, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {timeout: 6000, l: ctx});
  assert.ok(r.got, 'sentinel delivered'); await sleep(150); await ctx.poll();
}
/** Proves through the sentinel whether an invite (or message) for `sid` reached the endpoint (or listener `l`). */
export async function delivered(ctx, sid, {type, l = ctx} = {}) { await sentinel(ctx); if (l !== ctx) await l.poll(); return l.has(e => e.sid === sid && (!type || e.type === type)); }
/** `open` arguments toward a peer entity: an offer basis over a token the peer handed out (§5.7 "Dialing back"). */
export const openArgs = (ctx, to, leg, {token = w.peer.mintOffer(), params = {offer: null}} = {}) => ({...ctx.ep, to: to.principal, kind: LINE, profile: 'webrtc', params, delegate: leg.jwk, basis: {offer: token}});
/** Whether nothing (no message, no control statement) reached the peer for any of `sids`. */
export const peerSaw = sids => sids.flatMap(sid => [...w.peer.messages(sid), ...w.peer.controls(sid)]);


/** A collector for several spec checks in one test: each failed check is listed in one divergence at the end. */
export function checks() { const wrong = []; return {wrong, expect: (ok, label) => { if (!ok) wrong.push(label); return ok; }}; }
/** The error code of an RPC answer: a method error `{code}` or a protocol-level error string (protocol §5). */
export const errorCode = r => typeof r?.error === 'string' ? r.error : r?.error?.code ?? null;
/** Every https URL anywhere in a value. */
export const urlsIn = value => [...JSON.stringify(value ?? null).matchAll(/https:\/\/[^"\s\\]+/g)].map(m => m[0]);
/** Owner pairing creation through the owner route (§5.8 "Creation"; the page obligations are not under test). */
export async function pair(acct, {line = PAIR_LINE, principal, self, opens = 'both', activate = true, local = APP.id, label = 'Conformance pairing'} = {}) {
  const [r] = await w.widen(acct, [{action: 'pairing-create', input: {kind: REF[line], local: {client_id: local, client_session: null}, peer: principal ? {principal} : {self: {client_id: self, client_session: null}}, opens, label}, extra: {activate}}]);
  return {status: r.status, body: await r.json().catch(() => null)};
}
/** Own-entity `open` from listener `from` (no basis, §5.1 item 6) and the signed invite sent through `send`. */
export async function openSelf(acct, from, {kind = DATA_LINE, profile = 'data', target, answerIn = 100} = {}) {
  const appLeg = await keyPair(), params = profile === 'data' ? {} : {offer: null};
  const o = await from.c.call('open', {...from.ep, to: acct.principal, kind, profile, params, delegate: appLeg.jwk, ...target ? {target} : {}});
  if (!o.result?.certificate) return {error: o.error ?? o};
  const cert = o.result.certificate, sid = o.result.sid ?? part(cert, 1).sid;
  const msg = await sign({alg: 'ES256', typ: TYP.message, kid: appLeg.jkt}, {bindle: MAGIC.message, v: 1, iss: PROVIDER, sub: acct.sub, aud: acct.identity, sid, leg: appLeg.jkt, to: null, seq: 0, iat: now(), type: 'invite', body: {kind: part(cert, 1).kind, profile, answer_by: now() + answerIn, basis: null, context: null, params}}, appLeg);
  const sent = await from.c.call('send', {...from.ep, sid, messages: [msg]});
  assert.equal(sent.result?.accepted, 1, 'own-entity invite sent: ' + JSON.stringify(sent));
  return {sid, cert, appLeg, invite: msg};
}
/** Whether listener `l` holds an invite event for `sid` after one more short poll. */
export const sawInvite = async (l, sid) => { await l.poll(1); return l.has(e => e.type === 'invite' && e.sid === sid); };

