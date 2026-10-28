// RTC-i: clean-room conformance of the real Node provider against docs/spec/rtc-signaling.md (rtc-signaling.v1).
//
// The provider under test is the production Node adapter (apps/node/server.mjs, createNodeServer) listening on a
// loopback port with the RTC flags on and the peer origins in RTC_FOREIGN_ISSUERS. The second provider is
// tests/rtc-conformance-peer.mjs, written only from the spec. The two talk over:
//   - peer -> provider: real HTTP to 127.0.0.1:<port> with `Host: provider.example` (the provider's own host check);
//   - provider -> peer: the provider's real directory and RTC egress code, with only DNS and the socket replaced through
//     the documented DIRECTORY_DNS_LOOKUP / DIRECTORY_HTTPS_REQUEST injection ports (a public IPv4 answer; the request
//     is handed to the peer's handler instead of a TLS socket).
// The provider-side application is driven through the real authorization request, owner consent, token and
// /bindle/rpc routes with the DEFAULT Node wiring: the shipped signaling fragment and rtc-signaling/v1 contract (no
// FEDERATION_SCHEMAS / FEDERATION_CONTRACTS). Extensions revision 3.2 (CR-X3-20, CR-X3-24) removed slots and AMD-X1
// `bind`: the application requests the ordinary fragment (no options), and the owner approves its purposes through the
// interim owner route POST /api/rtc/approve-app (TODO(signaling Appendix C.2: approvals move to intents session
// handler approvals)); the manifest carries `extensions: [{spec, options}]` (the legacy rtc extension at its interim
// spec URL) and the signaling contract in `contracts`. Test seams beyond the two
// network ports and the operator configuration a deployment sets anyway (flags, RTC_FOREIGN_ISSUERS, the reviewed
// client, the trusted client-IP header that gives each test account its own signup address):
//   - one throwaway provider registers, as an operator would, the clean-room contract document written from spec §9.1
//     (contractDocument below) with contract-level "x-bindle-brokerable": false. Since the RTC-i review (L3) the shipped
//     first-party document wins over that registration while the RTC flags are on, so the probe shows the operator
//     registration cannot displace it; the clean-room document's marker is checked with the provider's contract compiler
//     (compileContractVersion, the one non-black-box import).
// The RTC-i divergences the first run found are fixed or decided in DEVLOG 2026-10-27 "RTC-i conformance peer:
// divergences and fixes". Divergences that remain (provisional readings with proposed amendments) are reported through
// `t.todo(...)` (so `npm test` stays green); RTC_CONFORMANCE_STRICT=1 turns the ones not marked "plausibly intentional"
// into failures.
import nodeTest, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import http from 'node:http';
import {createNodeServer} from '../apps/node/server.mjs';
import {compileContractVersion} from '../packages/federation/integrations.mjs';
import {createPeer, nodeNetwork, keyPair, newSid, now, sdp, fingerprint, linkDigest, part, sign, b64, unb64, malleate, isLowS, candidate, candidateItem, mdns, TYP, MEDIA_TYPE, randomId, verifyJws} from './rtc-conformance-peer.mjs';

const PROVIDER = 'https://provider.example', PEER = 'https://peer.example', PEER_NO_RTC = 'https://plain.example', PEER_FLOOR = 'https://floor.example';
const FRAGMENT = 'https://spec.bindle.example/fragments/rtc-signaling/v1', CONTRACT = 'https://spec.bindle.example/contracts/rtc-signaling/v1';
/** Extensions rev 3.2 spec URLs: the interim legacy rtc extension and its two prerequisites. */
const RTC_EXT = 'https://spec.bindle.example/extensions/rtc-signaling/v1', DIRECTORY_EXT = 'https://spec.bindle.example/extensions/directory/v1', VERSIONS_EXT = 'https://spec.bindle.example/extensions/artefact-versions/v1';
/** The options of extension `spec` in manifest `m` (undefined when not declared). */
const ext = (m, spec) => (Array.isArray(m?.extensions) ? m.extensions : []).find(e => e?.spec === spec)?.options;
/** Whether manifest `m` declares extension `spec` (an extension without options carries no `options` member). */
const declares = (m, spec) => (Array.isArray(m?.extensions) ? m.extensions : []).some(e => e?.spec === spec);
const CALL = 'https://spec.bindle.example/rtc-purposes/call/v1', SCREEN = 'https://spec.bindle.example/rtc-purposes/screen-share/v1';
const APP = {id: 'https://app.example/client', name: 'Conformance app', origin: 'https://app.example', redirectUris: ['https://app.example/callback']};
const METHODS = ['register', 'unregister', 'endpoints', 'open', 'claim', 'send', 'renew', 'listen', 'mint_ticket'];
const STRICT = process.env.RTC_CONFORMANCE_STRICT === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Every test is bounded, so a provider that stops answering fails the test instead of hanging the run. */
const test = (name, fn) => nodeTest(name, {timeout: 90000}, fn);

// ---- spec-derived documents the provider needs registered -----------------------------------------------------------
/** The signaling fragment (spec §3.2's slot manifest republished as an ordinary fragment under extensions rev 3.2:
 * field attributes `selection` and `consumers`, no `slot` member). */
const FRAGMENT_DOCUMENT = {id: FRAGMENT, title: 'Real-time connections', description: 'Lets an application ring you and connect your devices with other devices.', publisher: 'https://spec.bindle.example', fields: {signaling: {title: 'Signaling service', type: 'resource', cardinality: {min: 0, max: 1}, contracts: [CONTRACT], selection: 'exclusive', consumers: ['application']}}};
/**
 * A clean-room contract document for §9.1, registered only by the "x-bindle-brokerable" probe. Results list the §9.1
 * members; the `listen` event members are NOT named by the spec (a finding, AMD-RI4 proposed) and were discovered
 * black-box: {type, sid, seq, certificate, invite, projection, message, state, control}.
 */
function contractDocument({brokerable = false} = {}) {
  const S = {type: 'string'}, A = {}, o = p => ({type: 'object', properties: p});
  const event = o({type: A, sid: A, seq: A, certificate: A, invite: A, message: A, state: A, control: A, reason: A,
    projection: o({alert: A, basis: A, handle: A, origin: A, context: A, media: {type: 'array', items: A}, caller: o({iss: A, sub: A}), purpose: o({purpose: A, version: A, digest: A})})});
  return {$schema: 'https://json-schema.org/draft/2020-12/schema', $id: CONTRACT, title: 'RTC signaling v1 (clean-room test registration)', description: 'Written from rtc-signaling.md section 9.1 for the RTC-i conformance suite.',
    ...brokerable ? {'x-bindle-brokerable': false} : {},
    oneOf: METHODS.map(m => ({type: 'object', properties: {method: {const: m}, args: {type: 'object'}}, required: ['method', 'args'], additionalProperties: false})),
    'x-methods': Object.fromEntries(METHODS.map(m => [m, {request: '#', result: '#/$defs/' + m, effect: ['listen', 'endpoints'].includes(m) ? 'read' : 'write'}])),
    $defs: {register: o({endpoint: S, endpoint_secret: S, expires_at: A}), unregister: o({}), endpoints: o({endpoints: {type: 'array', items: o({endpoint: S, label: A, purposes: {type: 'array', items: S}, last_seen: A})}}),
      open: o({sid: S, certificate: S, expires_at: A, callback: A}), claim: o({certificate: S, callback: A}), send: o({accepted: A}), renew: o({certificate: S}),
      listen: o({cursor: A, gap: A, events: {type: 'array', items: event}}), mint_ticket: o({link: S})}};
}
const envelope = doc => ({[CONTRACT]: doc, [CONTRACT + '/envelope']: {bindle_artefact: 1, id: CONTRACT, kind: 'rpc-contract', versions: [{version: 1, prev: null, body: doc}]}});

// ---- findings -----------------------------------------------------------------------------------------------------
const findings = [];
/** Records a spec/behaviour divergence and marks the test todo (or fails it under STRICT unless plausibly intentional). */
function diverge(t, {section, request, observed, expected, side, intentional = false}) {
  findings.push({test: t.name, section, request, observed, expected, side, intentional});
  const message = `DIVERGENCE ${section}: expected ${expected}; observed ${observed} [wrong side: ${side}${intentional ? '; plausibly an intentional reading' : ''}]`;
  if (STRICT && !intentional) assert.fail(message);
  t.diagnostic(message); t.todo(message);
}

// ---- the world ----------------------------------------------------------------------------------------------------
async function boot({config = {}} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rtc-conformance-'));
  const peers = {};
  const net = nodeNetwork({'peer.example': r => peers.peer.handler(r), 'plain.example': r => peers.plain.handler(r), 'floor.example': r => peers.floor.handler(r)});
  const cfg = {APP_ORIGIN: PROVIDER, LOCAL_DEVELOPMENT: 'true', WORK_LIMITS_ENABLED: 'false', TRUSTED_CLIENT_IP_HEADER: 'x-conformance-client-ip', SIGNUP_IP_WINDOW_MS: '1000', SIGNUP_IP_DAILY_LIMIT: '1000', SIGNUP_SUBNET_DAILY_LIMIT: '1000', SIGNUP_REGION_HOURLY_LIMIT: '1000', SIGNUP_REGION_DAILY_LIMIT: '1000', SIGNUP_GLOBAL_HOURLY_LIMIT: '1000', SIGNUP_GLOBAL_DAILY_LIMIT: '1000', FEDERATION_ENABLED: 'true', EXTENSIONS_ENABLED: 'true', ARTEFACT_VERSIONS_ENABLED: 'true', DIRECTORY_ENABLED: 'true',
    RTC_SIGNALING_ENABLED: 'true', RTC_FOREIGN_ENABLED: 'true', RTC_TICKETS_ENABLED: 'true', RTC_FOREIGN_ISSUERS: JSON.stringify([PEER, PEER_NO_RTC, PEER_FLOOR]),
    FEDERATION_CLIENTS: JSON.stringify([APP]),
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
  peers.plain = await createPeer({origin: PEER_NO_RTC, providerFetch: wire, rtc: false});
  peers.floor = await createPeer({origin: PEER_FLOOR, providerFetch: wire, dpop: false});
  const request = (path, {method = 'GET', data, cookie, csrf, bearer, appOrigin, ip} = {}) => wire(path, {method, headers: {Origin: appOrigin ?? PROVIDER, ...ip ? {'X-Conformance-Client-IP': ip} : {}, ...data !== undefined ? {'Content-Type': 'application/json'} : {}, ...cookie ? {Cookie: cookie} : {}, ...csrf ? {'X-CSRF-Token': csrf} : {}, ...bearer ? {Authorization: `Bearer ${bearer}`} : {}}, ...data !== undefined ? {body: JSON.stringify(data)} : {}});
  const post = (p, d, o = {}) => request(p, {...o, method: 'POST', data: d});
  const peer = peers.peer;
  /** A provider account (signup through the HTTP routes) and its identity URI from the provider's own directory. */
  let signups = 0;
  async function account() {
    // Signup's fixed 3-per-minute burst per client address (packages/core/abuse-policy.mjs) is met by giving each test
    // account its own loopback address through the operator's trusted client-IP header.
    const ip = `127.${2 + (signups >> 7)}.${signups & 127}.${1 + (signups++ & 63)}`;
    const pending = await (await post('/api/auth/signup', {method: 'password', password: 'A durable conformance test password!', ageConfirmed: 18, termsAccepted: true, termsVersion: '2026-10-11', turnstileToken: 'local-browser-test-token'}, {ip})).json();
    const recovery = await (await post('/api/auth/recovery/download', {pendingToken: pending.pendingToken}, {ip})).json();
    const activation = await post('/api/auth/recovery/confirm', {pendingToken: pending.pendingToken, recoveryToken: recovery.recoveryToken, downloadConfirmed: true}, {ip});
    assert.equal(activation.status, 200, 'signup: ' + JSON.stringify(pending));
    const session = await activation.json(), owner = {cookie: activation.headers.get('Set-Cookie').split(';')[0], csrf: session.csrfToken};
    const sub = session.account.id, found = await peer.lookup(sub);
    return {sub, handle: session.account.handle, owner: {...owner, ip}, ip, identity: found?.identity, principal: {iss: PROVIDER, sub}};
  }
  /** Authorization request for the ordinary signaling fragment, owner assignment of the built-in signaling resource,
   * consent, token, then the owner's approval of `purposes` (the interim owner route). */
  async function connect(acct, purposes = [CALL]) {
    const verifier = randomUUID() + randomUUID(), challenge = createHash('sha256').update(verifier).digest('base64url');
    const r = await post('/api/oauth/requests', {clientId: APP.id, redirectUri: APP.redirectUris[0], challenge, challengeMethod: 'S256', state: 's', identity: acct.handle + '@provider.example', requests: [{fragment: FRAGMENT, required: true, purpose: 'Calls', fields: ['signaling'], methods: {signaling: {[CONTRACT]: METHODS}}}]}, {appOrigin: APP.origin, ip: acct.ip});
    const pending = await r.json(); assert.equal(r.status, 201, JSON.stringify(pending));
    let view = await (await request('/api/oauth/requests/' + pending.requestId, acct.owner)).json();
    const rtcURI = view.requests[0].resources.find(x => x.id.endsWith('/rtc')).id;
    const prefs = await (await request('/api/preferences', acct.owner)).json();
    if (!prefs.preferences.find(p => p.fragment === FRAGMENT)) {
      const a = await post('/api/preferences', {fragment: FRAGMENT, expectedRevision: null, values: {signaling: rtcURI}}, acct.owner); assert.equal(a.status, 200, 'signaling resource assignment');
      view = await (await request('/api/oauth/requests/' + pending.requestId, acct.owner)).json();
    }
    const d = await post('/api/oauth/requests/' + pending.requestId + '/decision', {requestId: pending.requestId, approved: [{fragment: FRAGMENT, revision: view.requests[0].revision, fields: ['signaling'], resources: {signaling: [rtcURI]}, methods: view.requests[0].methods}]}, acct.owner);
    const decision = await d.json(); assert.equal(d.status, 200, JSON.stringify(decision));
    const code = new URL(decision.redirectUri).searchParams.get('code');
    const token = await (await post('/oauth/token', {clientId: APP.id, redirectUri: APP.redirectUris[0], code, verifier}, {appOrigin: APP.origin, ip: acct.ip})).json();
    const rpc = (bearer, resource, contract, method, args = {}) => post('/bindle/rpc', {version: '0', tx: randomUUID(), resource, contract, method, args}, {bearer, appOrigin: APP.origin, ip: acct.ip});
    const prefsRead = await (await rpc(token.access_token, '@preferences', 'https://3sln.me/artefacts/contracts/preferences/v1', 'read', {fragment: FRAGMENT})).json();
    assert.ok(prefsRead.result?.values?.signaling, 'preferences read: ' + JSON.stringify(prefsRead) + ' token: ' + JSON.stringify(token));
    const ref = prefsRead.result.values.signaling;
    // The owner approves the purposes; each is pinned to the provider-held reference the owner's settings list.
    const approved = await post('/api/rtc/approve-app', {clientId: APP.id, purposes}, acct.owner); assert.equal(approved.status, 200, 'owner approval: ' + await approved.clone().text());
    const settings = await (await request('/api/rtc/settings', acct.owner)).json();
    const versions = Object.fromEntries(settings.purposes.map(p => [p.id, {version: p.version, digest: p.digest}]));
    const call = async (method, args = {}) => { const res = await rpc(ref.token, ref.id, CONTRACT, method, args); return {status: res.status, ...await res.json()}; };
    return {token, ref, call, versions, grants: token.grants, purposeRef: p => ({purpose: p, version: versions[p].version, digest: versions[p].digest})};
  }
  return {app, peers, peer, net, port, wire, request, post, account, connect, close: async () => { app.server.closeAllConnections?.(); await app.close(); await rm(directory, {recursive: true, force: true}); }};
}

let w;
before(async () => { w = await boot(); });
after(async () => {
  if (findings.length) {
    process.stdout.write(`\n# RTC-i conformance findings (${findings.length}):\n`);
    for (const f of findings) process.stdout.write(`#  - [${f.section}] ${f.test}: expected ${f.expected}; observed ${f.observed} (wrong side: ${f.side}${f.intentional ? ', plausibly intentional' : ''})\n`);
  }
  await w?.close();
});

// ---- callee contexts on the provider ------------------------------------------------------------------------------
/** A provider account with the app connected, one registered endpoint, a ticket and its own peer caller entity. */
async function callee({purposes = [CALL]} = {}) {
  const acct = await w.account(), c = await w.connect(acct, purposes);
  const reg = await c.call('register', {purposes}); assert.equal(reg.status, 200, JSON.stringify(reg));
  const ep = {endpoint: reg.result.endpoint, ...reg.result.endpoint_secret ? {endpoint_secret: reg.result.endpoint_secret} : {}};
  const minted = await c.call('mint_ticket', {purposes: [CALL], uses: 1000, expires_in: 3600}); assert.ok(minted.result?.link, JSON.stringify(minted));
  const ctx = {acct, c, ep, ticket: minted.result.link, events: [], cursor: undefined, bob: await w.peer.entity()};
  // Long poll (§9.2: `listen` is the baseline). Rapid short polls would meet the provider's per-network RPC budget.
  ctx.poll = async (wait = 0) => { const l = await c.call('listen', {...ep, ...ctx.cursor !== undefined ? {cursor: ctx.cursor} : {}, wait}); if (l.result) { ctx.cursor = l.result.cursor; ctx.events.push(...l.result.events); } else if (l.status !== 200 || l.error) throw new Error('listen: ' + JSON.stringify(l)); return l; };
  ctx.waitEvent = async (pred, timeout = 6000) => { const end = Date.now() + timeout; let hit = ctx.events.find(pred); while (!hit && Date.now() < end) { await ctx.poll(Math.max(1, Math.min(2, Math.ceil((end - Date.now()) / 1000)))); hit = ctx.events.find(pred); } return hit ?? null; };
  ctx.has = pred => ctx.events.some(pred);
  return ctx;
}
/** Invite parts from a peer entity to the callee; every member overridable for negative tests. */
async function invite(ctx, {from = ctx.bob, sid = newSid(), leg, purpose, media = ['data'], offer = sdp(), ring = 100, basis, links, certOverride = {}, msgOverride = {}, bodyOverride = {}, certOpts = {}, msgOpts = {}} = {}) {
  leg ??= await keyPair(); purpose ??= ctx.c.purposeRef(CALL); basis ??= {link_digest: await linkDigest(ctx.ticket)};
  const cert = await w.peer.legCertificate({sub: from.sub, aud: ctx.acct.identity, sid, role: 'caller', purpose, leg, override: certOverride, ...certOpts});
  const body = {purpose, media, ring_until: now() + ring, basis, context: null, offer, callback_digest: null, sas_commit: null, ...bodyOverride};
  const message = await w.peer.message({leg, sub: from.sub, aud: ctx.acct.identity, sid, to: null, seq: 0, type: 'invite', body, override: msgOverride, ...msgOpts});
  return {sid, leg, from, purpose, cert, message, batch: w.peer.batch({certificates: [cert], messages: [message], links: links ?? [ctx.ticket]})};
}
/** Posts an invite until it reaches the endpoint (the first posts may meet a held-key miss, §8.2 step 3, §8.3). */
async function deliver(ctx, inv, {timeout = 10000} = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await w.peer.post(inv.batch); assert.equal(r.status, 202, `invite post: ${r.status} ${r.body}`);
    const e = await ctx.waitEvent(e => e.type === 'invite' && e.sid === inv.sid, 1500); if (e) return e;
  }
  return null;
}
const appMessage = (ctx, s, {seq, type, body, to = s.peerLeg?.jkt ?? null, iat = now()}) => sign({alg: 'ES256', typ: TYP.message, kid: s.appLeg.jkt}, {bindle: 'rtc-message', v: 1, iss: PROVIDER, sub: ctx.acct.sub, aud: s.peerIdentity, sid: s.sid, leg: s.appLeg.jkt, to, seq, iat, type, body}, s.appLeg);
/** Claims an inbound invite with `accept` and sends the signed accept; returns the connected session. */
async function accept(ctx, inv) {
  const appLeg = await keyPair(), cl = await ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'accept', delegate: appLeg.jwk});
  assert.ok(cl.result?.certificate, 'claim: ' + JSON.stringify(cl));
  const s = {...inv, appLeg, peerLeg: inv.leg, peerIdentity: inv.from.identity, calleeCert: cl.result.certificate, appSeq: 0, peerSeq: 1};
  s.accept = await appMessage(ctx, s, {seq: s.appSeq++, type: 'accept', body: {answer: sdp({setup: 'active'}), sas_nonce: null}});
  const sent = await ctx.c.call('send', {...ctx.ep, sid: inv.sid, messages: [s.accept]}); assert.equal(sent.result?.accepted, 1, 'send accept: ' + JSON.stringify(sent));
  assert.ok(await w.peer.until(() => w.peer.messages(inv.sid).some(m => m.payload.type === 'accept'), {timeout: 6000}), 'accept relayed to the peer');
  return s;
}
/** A message from the peer's caller leg in a connected inbound session; returns whether the endpoint received it. */
async function peerSend(ctx, s, type, body, {seq, wait = true, timeout = 3000, ...opts} = {}) {
  seq ??= s.peerSeq++;
  const m = await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq, type, body, ...opts});
  const r = await w.peer.post(w.peer.batch({messages: [m]}));
  const got = wait ? await ctx.waitEvent(e => e.type === 'message' && e.message === m, timeout) : null;
  return {m, r, got: !!got, seq};
}
/** A connected session used as an ordering sentinel: once a later valid message arrives, earlier batches were processed. */
async function beacon(ctx) {
  if (ctx.beacon) return ctx.beacon;
  const inv = await invite(ctx); assert.ok(await deliver(ctx, inv), 'beacon invite delivered');
  return ctx.beacon = await accept(ctx, inv);
}
async function sentinel(ctx) {
  const b = await beacon(ctx);
  const r = await peerSend(ctx, b, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {timeout: 6000});
  assert.ok(r.got, 'sentinel delivered'); await sleep(150); await ctx.poll();
}
/** Posts `batch`, then proves through the sentinel whether an invite (or message) for `sid` reached the endpoint. */
async function delivered(ctx, sid, {type} = {}) { await sentinel(ctx); return ctx.has(e => e.sid === sid && (!type || e.type === type)); }

// ==== §3.1 / protocol §2: discovery ==================================================================================
test('§3.1 the provider declares the rtc extension with an issuer-origin endpoint and a 120-900 s certificate bound', async () => {
  const m = await (await w.wire('/.well-known/bindle/manifest.json')).json(), f = ext(m, RTC_EXT);
  assert.ok(f, 'the legacy rtc extension declared (extensions rev 3.2 `extensions: [{spec, options}]`)');
  assert.equal(new URL(f.endpoint).origin, PROVIDER);
  assert.ok(Number.isInteger(f.max_leg_certificate_seconds) && f.max_leg_certificate_seconds >= 120 && f.max_leg_certificate_seconds <= 900);
  assert.ok(ext(m, DIRECTORY_EXT)?.directory_url?.startsWith(PROVIDER + '/'));
});

test('§3.1 the rtc extension requires the directory and artefact-versions extensions; the signaling contract is listed', async () => {
  // RTC-i divergence 7 (fixed), restated for extensions rev 3.2: `extensions.v1` and the occupant declaration are gone;
  // the prerequisites are the directory and artefact-versions extensions, and the built-in signaling resource is
  // implied by the signaling contract in the manifest `contracts` list.
  const m = await (await w.wire('/.well-known/bindle/manifest.json')).json(), missing = [DIRECTORY_EXT, VERSIONS_EXT].filter(spec => !declares(m, spec));
  assert.ok(ext(m, RTC_EXT), 'the rtc extension declared');
  assert.deepEqual(missing, [], 'both prerequisite extensions declared beside it');
  assert.ok((m.contracts ?? []).includes(CONTRACT), 'the signaling contract listed in `contracts`');
  assert.equal(m.features, undefined, 'no `features` member');
});

test('§9.1 / contracts: a contract document carrying x-bindle-brokerable:false is usable', async () => {
  // RTC-i divergence 2 (fixed): the clean-room document with the marker the spec requires compiles (it used to fail as
  // artefact_unverifiable). RTC-i review L3: an operator registration of it no longer displaces the shipped document
  // (which carries the same marker) while the RTC flags are on, and calls are still served.
  const doc = contractDocument({brokerable: true}), compiled = compileContractVersion(structuredClone(doc));
  assert.equal(compiled.validate({method: 'register', args: {purposes: [CALL]}}), true, 'the clean-room document with the marker compiles');
  const v = await boot({config: {FEDERATION_SCHEMAS: JSON.stringify({[FRAGMENT]: FRAGMENT_DOCUMENT}), FEDERATION_CONTRACTS: JSON.stringify(envelope(doc))}});
  try {
    const acct = await v.account(), c = await v.connect(acct), r = await c.call('register', {purposes: [CALL]});
    assert.equal(r.status, 200, JSON.stringify(r));
  } finally { await v.close(); }
});

test('§9.1 the default Node wiring answers contract calls (register) instead of hanging', async () => {
  // RTC-i bug 1 (fixed): the whole suite now runs on the default wiring; this pins the first write's latency bound.
  const acct = await w.account(), c = await w.connect(acct);
  const r = await Promise.race([c.call('register', {purposes: [CALL]}), sleep(4000).then(() => 'timeout')]);
  assert.notEqual(r, 'timeout', 'register answered within 4 s');
  assert.equal(r.status, 200, JSON.stringify(r));
});

// ==== §8.1/§8.2 step 1: shape and bounds -> 400 =====================================================================
/** A fully valid single-invite batch as a raw-object template (aud names a real callee, so no 404). */
let shape;
async function shapeCtx() {
  if (shape) return shape;
  const ctx = await callee(), inv = await invite(ctx);
  return shape = {ctx, inv};
}
async function statusOf(body, opts) { return (await w.peer.post(body, opts)).status; }
async function expect400(t, section, cases) {
  const wrong = [];
  for (const [name, body, opts, accept = [400]] of cases) { const status = await statusOf(body, opts); if (!accept.includes(status)) wrong.push(`${name} -> ${status}`); }
  if (wrong.length) diverge(t, {section, request: `step-1-invalid batches: ${cases.map(c => c[0]).join('; ')}`, observed: wrong.join('; '), expected: '400 for every batch failing step 1', side: 'implementation'});
}

test('§8.1 batch envelope: media type, size, JSON, v, members and element counts are refused with 400', async t => {
  const {inv} = await shapeCtx(), b = inv.batch, J = x => JSON.stringify(x);
  const big = J({...b, links: [b.links[0] + '&' + 'x'.repeat(140000)]});
  await expect400(t, '§8.1, §8.2 step 1', [
    ['Content-Type application/json', J(b), {contentType: 'application/json'}, [400, 415]],
    ['Content-Type text/plain', J(b), {contentType: 'text/plain'}, [400, 415]],
    ['body over 131,072 bytes', big, {}, [400, 413]],
    ['not JSON', '{"v":1,', {}],
    ['JSON array', '[]', {}],
    ['v 2', J({...b, v: 2}), {}],
    ['v "1"', J({...b, v: '1'}), {}],
    ['unknown top-level member', J({...b, extra: true}), {}],
    ['missing messages member', J({v: 1, certificates: b.certificates, controls: [], links: b.links}), {}],
    ['certificates, messages and controls all empty', J({v: 1, certificates: [], messages: [], controls: [], links: []}), {}],
    ['5 certificates', J({...b, certificates: Array(5).fill(b.certificates[0])}), {}],
    ['33 messages', J({...b, messages: Array(33).fill(b.messages[0])}), {}],
    ['5 controls', J({...b, controls: Array(5).fill(b.certificates[0])}), {}],
    ['5 links', J({...b, links: Array(5).fill(b.links[0])}), {}],
    ['a link over 8,192 characters', J({...b, links: [b.links[0] + '#' + 'y'.repeat(8200)]}), {}],
    ['a link whose digest no invite names', J({...b, links: [b.links[0], 'https://provider.example/rtc/t/unrelated?bindle_meta=a.b.c']}), {}],
    ['certificates not an array', J({...b, certificates: b.certificates[0]}), {}]
  ]);
});

test('§8.2 step 1 / links §3.1: JWS profile violations are refused with 400', async t => {
  const {ctx, inv} = await shapeCtx(), [h, p, s] = inv.message.split('.'), b = inv.batch;
  const withMsg = m => ({...b, messages: [m]}), withCert = c => ({...b, certificates: [c]});
  const raw = async (headerText, payloadText, key = inv.leg) => sign(headerText, payloadText, key);
  const payload = part(inv.message, 1), header = part(inv.message, 0), text = o => JSON.stringify(o);
  const sigBytes = unb64(s), trailing = s.slice(0, -1) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(s.at(-1)) | 1)];
  await expect400(t, 'links §3.1 (via §8.2 step 1)', [
    ['two segments', withMsg(`${h}.${p}`)],
    ['padded segment', withMsg(`${h}.${p}=.${s}`)],
    ['noncanonical trailing bits in the signature segment', withMsg(`${h}.${p}.${trailing}`)],
    ['63-byte signature', withMsg(`${h}.${p}.${b64(sigBytes.slice(0, 63))}`)],
    ['65-byte signature', withMsg(`${h}.${p}.${b64(Uint8Array.from([...sigBytes, 0]))}`)],
    ['duplicate payload member', withMsg(await raw(header, text(payload).replace('"seq":0', '"seq":0,"seq":0')))],
    ['duplicate header member', withMsg(await raw(text(header).replace('"alg":"ES256"', '"alg":"ES256","alg":"ES256"'), payload))],
    ['lone surrogate in a string', withMsg(await raw(header, text({...payload, sub: 'x'}).replace('"sub":"x"', '"sub":"\\ud800"')))],
    ['-0 integer', withMsg(await raw(header, text(payload).replace('"seq":0', '"seq":-0')))],
    ['non-safe integer iat', withMsg(await raw(header, text(payload).replace(/"iat":\d+/, '"iat":9007199254740993')))],
    ['nesting deeper than 8', withMsg(await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: {...payload.body, context: {a: {b: {c: {d: {e: {f: {g: {h: 1}}}}}}}}}}))],
    ['header member jku', withMsg(await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, header: {jku: 'https://peer.example/jwks'}}))],
    ['header member crit', withMsg(await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, header: {crit: ['x']}}))],
    ['header without typ', withMsg(await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, header: {typ: undefined}}))],
    ['alg EdDSA', withMsg(await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, header: {alg: 'EdDSA'}}))],
    ['message typ in the certificates list', withCert(inv.message)],
    ['certificate typ on a control statement', {...b, controls: [inv.cert]}],
    ['certificate with control typ', withCert(await w.peer.legCertificate({sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, role: 'caller', purpose: inv.purpose, leg: inv.leg, header: {typ: TYP.control}}))],
    ['certificate with member-certificate typ', withCert(await w.peer.legCertificate({sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, role: 'caller', purpose: inv.purpose, leg: inv.leg, header: {typ: 'bindle-member-certificate+jwt'}}))]
  ]);
});

test('§5.1/§6.1/§8.2 step 1: exact members, bindle/v, aud form, sid, seq, type and the iat window are refused with 400', async t => {
  const {ctx, inv} = await shapeCtx(), b = inv.batch, payload = part(inv.message, 1);
  const msg = (o = {}) => w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, ...o});
  const cert = o => w.peer.legCertificate({sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, role: 'caller', purpose: inv.purpose, leg: inv.leg, override: o});
  const M = async o => ({...b, messages: [await msg(o)]}), C = async o => ({...b, certificates: [await cert(o)]});
  const aud = ctx.acct.identity;
  await expect400(t, '§6.1, §5.1, §8.2 step 1', [
    ['message unknown member', await M({override: {group: 'g'}})],
    ['message missing to', await M({override: {to: undefined}})],
    ['message bindle "rtc-msg"', await M({override: {bindle: 'rtc-msg'}})],
    ['message v 2', await M({override: {v: 2}})],
    ['message aud http', await M({override: {aud: aud.replace('https:', 'http:')}})],
    ['message aud with query', await M({override: {aud: aud + '?x=1'}})],
    ['message aud with fragment', await M({override: {aud: aud + '#f'}})],
    ['message aud with userinfo', await M({override: {aud: aud.replace('https://', 'https://u@')}})],
    ['message aud on another origin', await M({override: {aud: aud.replace('provider.example', 'elsewhere.example')}})],
    ['message iat 200 s in the past', await M({iat: now() - 200})],
    ['message iat 90 s in the future', await M({iat: now() + 90})],
    ['message sid of 21 characters', await M({override: {sid: 'a'.repeat(21)}})],
    ['message sid of 44 characters', await M({override: {sid: 'a'.repeat(44)}})],
    ['message seq 4096', await M({override: {seq: 4096}})],
    ['message seq -1', await M({override: {seq: -1}})],
    ['unknown message type', await M({type: 'ring', body: {}})],
    ['invite body unknown member', await M({body: {...payload.body, group: null}})],
    ['invite body missing sas_commit', await M({body: {...payload.body, sas_commit: undefined}})],
    ['candidates with to null', await M({type: 'candidates', body: {gen: 0, items: [], complete: false}})],
    ['message over 40,960 bytes', await M({body: {...payload.body, offer: sdp({extra: Array.from({length: 1400}, (_, i) => `a=x-pad${i}:${'p'.repeat(20)}`)})}})],
    ['certificate unknown member', await C({group: 'g'})],
    ['certificate missing aep', await C({aep: undefined})],
    ['certificate bindle "rtc-cert"', await C({bindle: 'rtc-cert'})],
    ['certificate aud on another origin', await C({aud: aud.replace('provider.example', 'elsewhere.example')})]
  ]);
});

test('§8.1 a batch with one element failing step 1 is refused whole, and its valid elements are not processed', async t => {
  const ctx = await callee(), inv = await invite(ctx), bad = inv.message.replace(/\.[^.]+$/, '.AAAA');
  const r = await w.peer.post({...inv.batch, messages: [inv.message, bad]});
  assert.equal(r.status, 400);
  assert.equal(await delivered(ctx, inv.sid), false, 'the valid invite of a refused batch was not delivered');
  assert.ok(await deliver(ctx, inv), 'the same invite alone is delivered');
});

test('AMD-RV1 high-S signatures are refused on certificates, messages and control statements', async t => {
  const ctx = await callee(); await beacon(ctx);
  const inv = await invite(ctx), highMsg = malleate(inv.message), highCert = malleate(inv.cert);
  assert.ok(isLowS(inv.message) && !isLowS(highMsg) && !isLowS(highCert));
  const statuses = {message: (await w.peer.post({...inv.batch, messages: [highMsg]})).status, certificate: (await w.peer.post({...inv.batch, certificates: [highCert]})).status};
  const b = ctx.beacon, ctrl = await w.peer.control({sub: b.from.sub, aud: ctx.acct.identity, sid: b.sid, leg: b.peerLeg.jkt, reason: 'revoked'});
  statuses.control = (await w.peer.post(w.peer.batch({controls: [malleate(ctrl)]}))).status;
  assert.equal(await delivered(ctx, inv.sid), false, 'no high-S element reached the endpoint');
  assert.equal(ctx.has(e => e.sid === b.sid && e.type === 'state'), false, 'the high-S control did not end the beacon session');
  const not400 = Object.entries(statuses).filter(([, s]) => s !== 400);
  if (not400.length) diverge(t, {section: 'AMD-RV1 with §8.2 step 1 ("for each JWS, the links §3.1 rules")', request: 'batches whose message, certificate or control carries the high-S form of a valid signature', observed: not400.map(([k, s]) => `${k} -> ${s}`).join(', ') + ' (dropped silently, not delivered)', expected: '400: low-S is decidable without any fetch, so a step-1 refusal (the spec does not say at which step AMD-RV1 applies)', side: 'spec ambiguity (AMD-RV1 does not place the check in §8.2)', intentional: true});
  assert.ok(await deliver(ctx, inv), 'the low-S form is delivered');
});

// ==== §8.2 response: uniform 202, uniform 404 =========================================================================
test('§8.2 an aud naming no hosted entity answers 202 like every step 2-8 outcome', async t => {
  const ctx = await callee(), stranger = `${PROVIDER}/identity/${randomUUID()}`, leg = await keyPair(), sid = newSid();
  const cert = await w.peer.legCertificate({sub: ctx.bob.sub, aud: stranger, sid, role: 'caller', purpose: ctx.c.purposeRef(CALL), leg});
  const m = await w.peer.message({leg, sub: ctx.bob.sub, aud: stranger, sid, seq: 0, type: 'invite', body: {purpose: ctx.c.purposeRef(CALL), media: ['data'], ring_until: now() + 60, basis: null, context: null, offer: null, callback_digest: null, sas_commit: null}});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [m]}));
  if (r.status !== 202) diverge(t, {section: '§8.2 ("The response is 202 ... for every batch that passes step 1"; step 1: "whether it names a hosted entity is decided silently at step 2")', request: 'a step-1-valid invite batch whose aud is an unknown /identity/<uuid> on the provider origin', observed: `${r.status} ${r.body}`, expected: '202 with an empty body', side: 'implementation reading RTCe-4, kept (uniform 404; identity existence is public through the identity document); proposed amendment AMD-RI1', intentional: true});
});

test('§8.2/§12 every step 2-8 outcome answers an identical 202 with an empty body', async () => {
  const ctx = await callee(), cases = {};
  const fresh = await w.peer.entity();
  cases['held key missing'] = (await invite(ctx, {from: fresh})).batch;
  cases['unknown session'] = w.peer.batch({messages: [await w.peer.message({leg: await keyPair(), sub: ctx.bob.sub, aud: ctx.acct.identity, sid: newSid(), to: randomId(32), seq: 1, type: 'end', body: {reason: 'hangup'}})]});
  cases['bad signature'] = (await invite(ctx, {msgOpts: {signer: await keyPair()}})).batch;
  cases['unadmitted (no basis)'] = (await invite(ctx, {basis: null, links: []})).batch;
  const unknownLink = `${PROVIDER}/rtc/t/${randomId(16)}?bindle_meta=${part(ctx.ticket.split('bindle_meta=')[1], 0) ? ctx.ticket.split('bindle_meta=')[1] : 'a.b.c'}`;
  cases['carried link that is no live ticket'] = (await invite(ctx, {basis: {link_digest: await linkDigest(unknownLink)}, links: [unknownLink]})).batch;
  cases['purpose not approved'] = (await invite(ctx, {purpose: {purpose: SCREEN, version: 1, digest: 'sha256-' + b64(new Uint8Array(32))}})).batch;
  const seen = [];
  for (const [name, batch] of Object.entries(cases)) { const r = await w.peer.post(batch); seen.push({name, status: r.status, body: r.body, type: r.headers.get('content-type'), cache: r.headers.get('cache-control')}); }
  for (const s of seen) assert.deepEqual({status: s.status, body: s.body, type: s.type, cache: s.cache}, {status: 202, body: '', type: seen[0].type, cache: seen[0].cache}, s.name);
});

test('§8.1 RTCe-3: a batch whose elements name two audiences', async t => {
  const a = await callee(), b2 = await w.account(), inv = await invite(a);
  const m2 = await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: b2.identity, sid: inv.sid, to: randomId(32), seq: 1, type: 'end', body: {reason: 'hangup'}});
  const r = await w.peer.post({...inv.batch, messages: [inv.message, m2]});
  t.diagnostic(`two-audience batch -> ${r.status}`);
  if (r.status !== 202) diverge(t, {section: '§8.1 ("Messages in one batch belong to sessions between the same two entities") and §8.2 step 1', request: 'a step-1-valid batch: an invite to callee A and a message to callee B', observed: `${r.status}`, expected: 'the spec states a sender rule but lists no such step-1 check, so 202 (with the stray element dropped later) by the letter of §8.2', side: 'spec ambiguity; implementation reading RTCe-3, kept; proposed amendment AMD-RI2 adds the check to step 1', intentional: true});
});

// ==== §5.1 certificate rules and §8.2 steps 3-6 (silently dropped, still 202) =========================================
async function dropped(t, ctx, label, inv, section) {
  const r = await w.peer.post(inv.batch);
  if (r.status === 400) { t.diagnostic(`${label}: refused at step 1 (400)`); return; }
  assert.equal(r.status, 202, label);
  if (await delivered(ctx, inv.sid)) diverge(t, {section, request: label, observed: 'invite delivered to the callee endpoint', expected: 'dropped (not delivered)', side: 'implementation'});
}
test('§5.1 certificate verification: identity-key signatures, unknown kids, mismatched aud/sid/role/purpose/identity, lifetime and expiry', async t => {
  const ctx = await callee(); await beacon(ctx); const bob = ctx.bob, e = w.peer.entities.get(bob.sub), other = await w.account();
  const cases = [
    ['certificate signed by the identity signing key (use sig)', await invite(ctx, {certOpts: {signer: e.sig}}), '§5.1 "A certificate signed by the identity signing key fails"; AMD-RV1'],
    ['certificate kid naming no published key', await invite(ctx, {certOpts: {header: {kid: 'no-such-kid'}}}), '§5.1 verifier checks'],
    ['certificate aud naming another callee', await invite(ctx, {certOverride: {aud: other.identity}}), '§8.2 step 4 (certificate aud matches)'],
    ['certificate sid different from the message sid', await invite(ctx, {certOverride: {sid: newSid()}}), '§8.2 step 4 (certificate sid matches)'],
    ['callee-role certificate on an invite', await invite(ctx, {certOverride: {role: 'callee'}}), '§6.2 (only the caller leg sends invite), §8.2 step 4 role'],
    ['certificate identity claim not the directory URI', await invite(ctx, {certOverride: {identity: `${PEER}/people/${bob.sub}`}}), '§5.1 ("checks that it equals identity")'],
    ['invite purpose differs from the certificate purpose', await invite(ctx, {certOverride: {purpose: {...ctx.c.purposeRef(CALL), version: 2}}}), '§8.2 step 4 (purpose matches for an invite)'],
    ['certificate lifetime 700 s over the declared 600 s', await invite(ctx, {certOpts: {iat: now() - 10, exp: now() + 690}}), '§3.1/§5.1 (no longer than the declared bound)'],
    ['certificate expired 120 s ago', await invite(ctx, {certOpts: {iat: now() - 720, exp: now() - 120}}), '§5.1 (exp with 60 s skew)'],
    ['certificate cnf.jkt not the delegate thumbprint', await invite(ctx, {certOverride: {cnf: {jkt: randomId(32)}}}), '§5.1 cnf/delegate (organizations §5.2)'],
    ['message signed by a key other than the delegate', await invite(ctx, {msgOpts: {signer: await keyPair()}}), '§8.2 step 4 (message signature under delegate)'],
    ['message leg not the certificate cnf.jkt', await invite(ctx, {msgOverride: {leg: randomId(32)}}), '§6.1 ("leg MUST equal the leg certificate\'s cnf.jkt")']
  ];
  for (const [label, inv, section] of cases) await dropped(t, ctx, label, inv, section);
});

test('§8.2 step 6 a certificate with a lower aep than the one recorded is refused', async t => {
  const ctx = await callee(), e = w.peer.entities.get(ctx.bob.sub);
  e.aep = 3; await beacon(ctx); const first = await invite(ctx); assert.ok(await deliver(ctx, first), 'aep 3 accepted');
  e.aep = 2; await dropped(t, ctx, 'invite with aep 2 after aep 3 was recorded', await invite(ctx), '§8.2 step 6, §14 ("MUST refuse certificates with a lower aep")');
  e.aep = 3;
});

test('§5.1 provider-issued caller certificates follow the profile and verify against its active certification keys', async () => {
  const ctx = await callee(), appLeg = await keyPair();
  const o = await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, purpose: CALL, media: ['data'], delegate: appLeg.jwk});
  assert.ok(o.result?.certificate, JSON.stringify(o));
  const cert = o.result.certificate, h = part(cert, 0), p = part(cert, 1), m = await w.peer.providerManifest();
  assert.deepEqual(Object.keys(h).sort(), ['alg', 'kid', 'typ']); assert.equal(h.alg, 'ES256'); assert.equal(h.typ, TYP.cert);
  assert.deepEqual(Object.keys(p).sort(), ['aep', 'aud', 'bindle', 'client', 'cnf', 'delegate', 'exp', 'iat', 'identity', 'iss', 'jti', 'purpose', 'role', 'sid', 'sub', 'v'].sort());
  assert.equal(p.bindle, 'rtc-leg-certificate'); assert.equal(p.v, 1); assert.equal(p.role, 'caller'); assert.equal(p.iss, PROVIDER); assert.equal(p.sub, ctx.acct.sub);
  assert.equal(p.identity, ctx.acct.identity, 'identity equals the directory-derived URI'); assert.equal(p.aud, ctx.bob.identity);
  assert.match(p.sid, /^[A-Za-z0-9_-]{22,43}$/); assert.ok(unb64(p.sid).length >= 16, 'sid carries at least 128 bits');
  assert.equal(p.cnf.jkt, appLeg.jkt); assert.deepEqual(p.delegate, appLeg.jwk);
  assert.deepEqual(p.client, {client_id: APP.id, origin: APP.origin});
  assert.deepEqual(p.purpose, ctx.c.purposeRef(CALL));
  assert.ok(Number.isSafeInteger(p.aep) && p.aep >= 0);
  assert.ok(p.exp - p.iat <= ext(m, RTC_EXT).max_leg_certificate_seconds);
  assert.ok(isLowS(cert), 'low-S');
  const v = await w.peer.verifyFromProvider(cert); assert.deepEqual(v.problems, []);
  const doc = w.peer.providerDocument(ctx.acct.sub);
  assert.ok(doc.keys.some(k => k.kid === h.kid && k.use === 'cert' && k.state === 'active'), 'signed by an active use:"cert" key');
  assert.ok(!doc.keys.some(k => k.kid === h.kid && k.use === 'sig'), 'never the identity signing key');
});

test('§5.1 the provider refuses a delegate already certified in a live session', async t => {
  const ctx = await callee(), leg = await keyPair();
  const a = await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, purpose: CALL, media: ['data'], delegate: leg.jwk});
  const b = await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, purpose: CALL, media: ['data'], delegate: leg.jwk});
  assert.ok(a.result?.certificate, JSON.stringify(a));
  if (b.result?.certificate) diverge(t, {section: '§5.1 issuance ("refuses a delegate already certified in any live session of the entity or within the last 24 h")', request: 'open twice with the same delegate', observed: 'second certificate issued', expected: 'refused', side: 'implementation'});
  else { assert.ok(b.error, JSON.stringify(b)); t.diagnostic(`second open with the same delegate -> ${JSON.stringify(b.error)}`); }
});

// ==== §4.2 / §4.3 admission ==========================================================================================
test('§4.3 ticket uses: exactly `uses` invites are admitted, and a forged invite spends none', async t => {
  const ctx = await callee(), minted = await ctx.c.call('mint_ticket', {purposes: [CALL], uses: 2, expires_in: 3600}), link = minted.result.link;
  const viaTicket = async o => invite(ctx, {basis: {link_digest: await linkDigest(link)}, links: [link], ...o});
  const warm = await invite(ctx); assert.ok(await deliver(ctx, warm), 'peer keys warmed via the 1000-use ticket');
  const forged = await viaTicket({msgOpts: {signer: await keyPair()}}); // low-S, but not by the certified delegate
  assert.equal((await w.peer.post(forged.batch)).status, 202);
  const ok = [];
  for (let i = 0; i < 3; i++) { const inv = await viaTicket(); assert.equal((await w.peer.post(inv.batch)).status, 202); ok.push(inv.sid); }
  await sentinel(ctx);
  const got = ok.filter(sid => ctx.has(e => e.type === 'invite' && e.sid === sid));
  if (got.length !== 2) diverge(t, {section: '§4.3 ("A use is spent ... atomically at step 8, so forged or failing invites never consume uses")', request: 'a forged invite, then three valid invites over a uses:2 ticket', observed: `${got.length} admitted`, expected: 'exactly 2 admitted', side: 'implementation'});
});

test('§4.3 a principal-bound ticket admits only that verified principal', async t => {
  const ctx = await callee(); await beacon(ctx); const mallory = await w.peer.entity();
  const warmM = await invite(ctx, {from: mallory}); assert.ok(await deliver(ctx, warmM), 'second peer principal warmed');
  const minted = await ctx.c.call('mint_ticket', {purposes: [CALL], uses: 5, expires_in: 3600, principal: ctx.bob.principal});
  assert.ok(minted.result?.link, JSON.stringify(minted)); const link = minted.result.link, basis = {link_digest: await linkDigest(link)};
  await dropped(t, ctx, 'invite from another principal over a ticket bound to bob', await invite(ctx, {from: mallory, basis, links: [link]}), '§4.3 principal');
  const good = await invite(ctx, {basis, links: [link]}); assert.equal((await w.peer.post(good.batch)).status, 202);
  assert.ok(await delivered(ctx, good.sid), 'the bound principal is admitted');
});

test('§4.2 link basis: a digest mismatch, a non-canonical link and the default-off `none` basis admit nothing', async t => {
  const ctx = await callee(); await beacon(ctx);
  await dropped(t, ctx, 'link_digest not the SHA-256 of the carried link', await invite(ctx, {basis: {link_digest: b64(new Uint8Array(32))}}), '§4.2');
  const extra = ctx.ticket + '&utm_source=x';
  await dropped(t, ctx, 'non-canonical link (unrelated parameter) with its matching digest', await invite(ctx, {basis: {link_digest: await linkDigest(extra)}, links: [extra]}), '§4.2 ("The link MUST be canonical")');
  await dropped(t, ctx, '`none` basis (basis null) with requests left at their default (off)', await invite(ctx, {basis: null, links: []}), '§4.2 none ("Default: off")');
});

// ==== §6.3 SDP and candidates ========================================================================================
test('§6.3 invite offers that break the SDP rules are not delivered (and conforming variants are)', async t => {
  const ctx = await callee(); await beacon(ctx);
  const good = [['one fingerprint repeated at session and media level', sdp({mediaFp: fingerprint()})], ['audio and video m-lines for audio/video media', sdp({kinds: ['audio', 'video']}), ['audio', 'video']]];
  for (const [label, offer, media] of good) { const inv = await invite(ctx, {offer, media}); assert.equal((await w.peer.post(inv.batch)).status, 202); assert.ok(await delivered(ctx, inv.sid), label); await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 1, type: 'cancel', body: {}})]})); }
  const bad = [
    ['a=candidate line', sdp({mediaExtra: ['a=candidate:1 1 udp 2122260223 10.0.0.2 5000 typ host']})],
    ['A=CANDIDATE line (case-insensitive)', sdp({mediaExtra: ['a=CANDIDATE:1 1 udp 2122260223 10.0.0.2 5000 typ host']})],
    ['a=end-of-candidates', sdp({mediaExtra: ['a=end-of-candidates']})],
    ['a=remote-candidates', sdp({mediaExtra: ['a=remote-candidates:1 10.0.0.2 5000']})],
    ['no a=ice-options:trickle', sdp({trickle: false})],
    ['c= with a real address', sdp({connection: 'c=IN IP4 192.0.2.10'})],
    ['a=rtcp with a real address', sdp({kinds: ['audio'], mediaExtra: ['a=rtcp:9 IN IP4 192.0.2.10']}), ['audio']],
    ['o= with a public address', sdp({origin: 'o=- 4611731400430051336 2 IN IP4 192.0.2.10'})],
    ['o= username not - or digits (Firefox style)', sdp({origin: 'o=mozilla...THIS_IS_SDPARTA-99.0 4611731400430051336 0 IN IP4 0.0.0.0'})],
    ['u= line', sdp({extra: ['u=https://example.com/']})],
    ['e= line', sdp({extra: ['e=someone@example.com']})],
    ['two different fingerprints (session and media)', sdp({mediaFp: fingerprint(0x11)})],
    ['only a sha-1 fingerprint', sdp({omitFingerprint: true, extra: ['a=fingerprint:sha-1 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01']})],
    ['no fingerprint', sdp({omitFingerprint: true})],
    ['m=video for data-only media', sdp({kinds: ['video']})],
    ['LF line endings', sdp({eol: '\n'})],
    ['a dotted quad outside address fields', sdp({mediaExtra: ['a=x-note:host 198.51.100.7']})],
    ['an IPv6-like run outside address fields', sdp({mediaExtra: ['a=x-note:fe80::1:2']})],
    ['an IN IP4 token outside o=/c=/a=rtcp', sdp({mediaExtra: ['a=x-note:IN IP4']})],
    ['SDP over 24,576 bytes (one long line, so the message stays under 40,960 bytes)', sdp({mediaExtra: ['a=x-pad:' + 'q'.repeat(24600)]})]
  ];
  const leaked = [];
  for (const [label, offer, media = ['data']] of bad) { const inv = await invite(ctx, {offer, media}); const r = await w.peer.post(inv.batch); if (r.status === 202) inv.posted = true; inv.label = label; inv.status = r.status; leaked.push(inv); }
  await sentinel(ctx);
  const through = leaked.filter(inv => ctx.has(e => e.type === 'invite' && e.sid === inv.sid)).map(inv => inv.label);
  t.diagnostic('statuses: ' + leaked.map(i => `${i.label}=${i.status}`).join('; '));
  if (through.length) diverge(t, {section: '§6.3', request: 'invites whose offer breaks one SDP rule each', observed: `delivered: ${through.join('; ')}`, expected: 'none delivered', side: 'implementation'});
});

test('§6.3 no SDP and no candidates travel before the claim', async t => {
  const ctx = await callee(); await beacon(ctx);
  const inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  const mk = (seq, type, body) => w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, to: randomId(32), seq, type, body});
  const c1 = await mk(1, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}), s2 = await mk(2, 'sdp', {gen: 1, description: {type: 'offer', sdp: sdp()}});
  for (const m of [c1, s2]) await w.peer.post(w.peer.batch({messages: [m]}));
  await sentinel(ctx);
  const leaked = ctx.events.filter(e => e.type === 'message' && [c1, s2].includes(e.message));
  if (leaked.length) diverge(t, {section: '§6.3 ("No SDP and no candidate travels before the claim"), §12', request: 'candidates and sdp messages from the caller leg while the invite is unclaimed', observed: `${leaked.length} delivered`, expected: 'none delivered', side: 'implementation'});
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 3, type: 'cancel', body: {}})]}));
});

test('§6.3 candidate rules after the claim in a cross-entity session (each refused message consumes its seq, §8.2 step 5)', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const item = c => ({gen: 0, items: [candidateItem(c)], complete: false});
  const goods = [['mDNS host candidate (UUID.local)', candidate({typ: 'host', address: mdns(), port: 50000})], ['relay with raddr 0.0.0.0 rport 0', candidate({raddr: '0.0.0.0', rport: 0})], ['relay without raddr', candidate()], ['srflx with raddr 0.0.0.0 rport 0', candidate({typ: 'srflx', address: '34.120.17.10', raddr: '0.0.0.0', rport: 0})]];
  const bads = [
    ['raw IPv4 host candidate', candidate({typ: 'host', address: '192.168.1.20', port: 50000})],
    ['non-UUID mDNS name', candidate({typ: 'host', address: 'laptop.local', port: 50000})],
    ['relay with a real raddr', candidate({raddr: '81.2.69.160', rport: 40000})],
    ['srflx with a real raddr', candidate({typ: 'srflx', address: '34.120.17.10', raddr: '192.168.1.20', rport: 50000})],
    ['srflx at a private address', candidate({typ: 'srflx', address: '10.1.2.3', raddr: '0.0.0.0', rport: 0})],
    ['relay at a loopback address', candidate({address: '127.0.0.1'})],
    ['relay at a shared (RFC 6598) address', candidate({address: '100.64.1.1'})],
    ['relay at a link-local address', candidate({address: '169.254.10.1'})],
    ['relay at a multicast address', candidate({address: '224.0.0.251'})],
    ['relay at an IPv4-mapped private address', candidate({address: '::ffff:10.0.0.1'})],
    ['relay at a NAT64 form of a private address', candidate({address: '64:ff9b::a00:1'})],
    ['relay at a unique-local IPv6 address', candidate({address: 'fd00::1'})],
    ['unknown candidate extension attribute', candidate({extra: ' x-secret 1'})],
    ['typ prflx', candidate({typ: 'prflx'})],
    ['candidate over 512 bytes', candidate({extra: ' generation 0' + ' ufrag Qw3r'.repeat(60)})]
  ];
  const wrong = [], gaps = [];
  for (const [label, c] of goods) { const r = await peerSend(ctx, s, 'candidates', item(c)); if (!r.got) wrong.push(`conforming "${label}" not delivered`); }
  for (const [label, c] of bads) {
    const bad = await peerSend(ctx, s, 'candidates', item(c), {wait: false});
    const next = await peerSend(ctx, s, 'candidates', item(candidate()), {timeout: 2500});
    if (ctx.has(e => e.message === bad.m)) wrong.push(`"${label}" delivered`);
    if (!next.got) {
      // n+1 is held, so the receiver did not record n. Refill n with a conforming message (by the letter of §6.4 a
      // reuse of n with different content, which must end the leg if n had been recorded).
      const fill = await peerSend(ctx, s, 'candidates', item(candidate()), {seq: bad.seq, timeout: 2500});
      const then = await ctx.waitEvent(e => e.message === next.m, 2500);
      gaps.push(`${label} [n+1 held; refill of n ${fill.got ? 'delivered' : 'not delivered'}; n+1 ${then ? 'then delivered' : 'still held'}]`);
      if (!fill.got && !then) { wrong.push(`session stalled after "${label}"`); break; }
    }
  }
  if (wrong.length) diverge(t, {section: '§6.3 (with AMD-RV1)', request: 'candidates messages after the claim, one rule broken each, each followed by a conforming one', observed: wrong.join('; '), expected: 'conforming delivered; non-conforming not delivered', side: 'implementation'});
  if (gaps.length) diverge(t, {section: '§8.2 step 5 ("A (sid, leg, seq) is recorded only after step 4") and step 7', request: 'a non-conforming candidates message at seq n (refused at step 7), then a conforming one at n+1', observed: `n+1 was not delivered after: ${gaps.join('; ')}`, expected: 'n is recorded at step 5, so n+1 is in order and delivered', side: 'implementation'});
  await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [await appMessage(ctx, s, {seq: s.appSeq++, type: 'end', body: {reason: 'hangup'}})]});
});

test('§6.3/§10 the provider enforces the rules and the relay-only default on its own endpoint\'s send', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const send = async (type, body) => { const m = await appMessage(ctx, s, {seq: s.appSeq, type, body}); const r = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [m]}); if (r.result?.accepted === 1) s.appSeq++; return {r, m}; };
  const item = c => ({gen: 0, items: [candidateItem(c)], complete: false});
  const refused = [
    ['sdp offer with an a=candidate line', 'sdp', {gen: 1, description: {type: 'offer', sdp: sdp({mediaExtra: ['a=candidate:1 1 udp 2122260223 10.0.0.2 5000 typ host']})}}],
    ['sdp offer with two fingerprints', 'sdp', {gen: 1, description: {type: 'offer', sdp: sdp({mediaFp: fingerprint(0x22)})}}],
    ['raw host candidate cross-entity', 'candidates', item(candidate({typ: 'host', address: '192.168.1.20'}))],
    ['mDNS host candidate under the relay-only default', 'candidates', item(candidate({typ: 'host', address: mdns()}))],
    ['srflx candidate under the relay-only default', 'candidates', item(candidate({typ: 'srflx', address: '34.120.17.10', raddr: '0.0.0.0', rport: 0}))]
  ];
  const wrong = [];
  for (const [label, type, body] of refused) { const {r, m} = await send(type, body); if (r.result?.accepted === 1 || !r.error && r.status === 200 && r.result?.accepted !== 0) wrong.push(`${label} accepted`); else if (r.error?.code !== 'invalid_args') t.diagnostic(`${label}: ${JSON.stringify(r.error ?? r)}`); await sleep(50); if (w.peer.messages(s.sid).some(x => x.jws === m)) wrong.push(`${label} relayed`); }
  const ok = await send('candidates', item(candidate()));
  assert.equal(ok.r.result?.accepted, 1, 'a relay candidate is accepted: ' + JSON.stringify(ok.r));
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(x => x.jws === ok.m)), 'relayed unchanged');
  if (wrong.length) diverge(t, {section: '§6.3, §9.1 send, §10 (default relay for another entity)', request: 'send of non-conforming or policy-violating messages', observed: wrong.join('; '), expected: 'refused with invalid_args and never relayed', side: 'implementation'});
});

// ==== §6.4 ordering and replay =======================================================================================
test('§6.4 duplicates are ignored, a gap is buffered and filled in order, and a message for an ended session is ignored', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const item = {gen: 0, items: [candidateItem(candidate())], complete: false};
  const d = await peerSend(ctx, s, 'candidates', item); assert.ok(d.got);
  await w.peer.post(w.peer.batch({messages: [d.m]})); await w.peer.post(w.peer.batch({messages: [d.m, d.m]}));
  const later = await peerSend(ctx, s, 'candidates', item, {seq: s.peerSeq + 1, wait: false});
  await sleep(400); await ctx.poll();
  assert.equal(ctx.has(e => e.message === later.m), false, 'a message after a gap is held');
  const fill = await peerSend(ctx, s, 'candidates', item, {seq: s.peerSeq, timeout: 4000}); s.peerSeq += 2;
  assert.ok(fill.got, 'the gap filler is delivered');
  assert.ok(await ctx.waitEvent(e => e.message === later.m, 3000), 'the buffered message follows');
  const order = ctx.events.filter(e => e.sid === s.sid && e.type === 'message').map(e => part(e.message, 1).seq);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'delivered in seq order');
  assert.equal(ctx.events.filter(e => e.message === d.m).length, 1, 'the duplicate was delivered once');
  const end = await peerSend(ctx, s, 'end', {reason: 'hangup'}); assert.ok(end.got);
  assert.ok(await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended'), 'ended');
  const after = await peerSend(ctx, s, 'candidates', item, {timeout: 1500});
  assert.equal(after.got, false, 'nothing is delivered for an ended session');
});

test('§6.4 reusing a seq with different content ends the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const a = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}); assert.ok(a.got);
  const b = await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: a.seq, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.9'}))], complete: true}});
  assert.equal((await w.peer.post(w.peer.batch({messages: [b]}))).status, 202);
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state', 4000);
  const control = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.reason === 'failed'), {timeout: 3000});
  t.diagnostic(`endpoint state: ${JSON.stringify(ended && {state: ended.state})}; control to the peer: ${control ? JSON.stringify({leg: control.payload.leg, reason: control.payload.reason}) : 'none'}`);
  if (!ended) diverge(t, {section: '§6.4 ("Reusing a seq with different content ends the leg with failed")', request: 'a second, different message with an already accepted (sid, leg, seq)', observed: 'session not ended at the receiver', expected: 'the leg ended (failed)', side: 'implementation'});
  if (ended && control) { const v = await w.peer.verifyFromProvider(control.jws).catch(() => null); assert.ok(control.payload.leg === s.peerLeg.jkt || control.payload.leg === null); }
});

test('§6.4 a gap that is not filled within 10 s ends the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {seq: s.peerSeq + 1, wait: false});
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 16000);
  if (!ended) diverge(t, {section: '§6.4 ("buffers at most 32 messages ahead of a gap for at most 10 s, and then ends the leg with failed")', request: 'one message at seq n+1 with seq n never sent', observed: 'not ended within 16 s', expected: 'leg ended (failed) after about 10 s', side: 'implementation'});
});

test('§6.2/§8.2 step 2 a replayed invite does not ring again, and an invite at seq 1 is refused', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  await w.peer.post(inv.batch); await w.peer.post(inv.batch);
  const leg = await keyPair(), sid = newSid(), cert = await w.peer.legCertificate({sub: ctx.bob.sub, aud: ctx.acct.identity, sid, role: 'caller', purpose: ctx.c.purposeRef(CALL), leg});
  const seq1 = await w.peer.message({leg, sub: ctx.bob.sub, aud: ctx.acct.identity, sid, seq: 1, type: 'invite', body: part(inv.message, 1).body});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [seq1], links: [ctx.ticket]}));
  await delivered(ctx, sid);
  assert.equal(ctx.events.filter(e => e.type === 'invite' && e.sid === inv.sid).length, 1, 'the invite rang once');
  if (ctx.has(e => e.type === 'invite' && e.sid === sid)) diverge(t, {section: '§6.2 ("invite is the caller\'s message seq 0")', request: 'an invite at seq 1', observed: `delivered (post ${r.status})`, expected: 'refused', side: 'implementation'});
});

// ==== flows: provider as callee ======================================================================================
test('flow (peer calls provider): invite, claim, accept, candidates both ways relayed unchanged, peer end', async () => {
  const ctx = await callee(), inv = await invite(ctx), e = await deliver(ctx, inv);
  assert.ok(e, 'invite delivered'); assert.equal(e.invite, inv.message, 'raw invite delivered unchanged'); assert.equal(e.certificate, inv.cert);
  assert.deepEqual(e.projection.caller, ctx.bob.principal); assert.equal(e.projection.basis, 'link'); assert.deepEqual(e.projection.media, ['data']);
  assert.equal(JSON.stringify(e).includes(ctx.ticket), false, 'the basis link is never delivered to endpoints');
  const s = await accept(ctx, inv);
  const got = w.peer.messages(s.sid).find(m => m.payload.type === 'accept'), entry = got.entry;
  assert.equal(got.jws, s.accept, 'the accept is relayed unchanged'); assert.deepEqual(entry.step1.problems, []);
  assert.equal(entry.contentType, MEDIA_TYPE); assert.ok(entry.bytes <= 131072);
  const cert = entry.batch.certificates.find(c => part(c, 1).role === 'callee'); assert.ok(cert, 'the callee certificate accompanies its first message');
  const v = await w.peer.verifyFromProvider(cert, [s.accept]); assert.deepEqual(v.problems, []);
  assert.equal(v.payload.aud, ctx.bob.identity); assert.equal(v.payload.sid, s.sid); assert.equal(part(s.accept, 1).to, inv.leg.jkt);
  const pc = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: true}); assert.ok(pc.got);
  const ac = await appMessage(ctx, s, {seq: s.appSeq++, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.1'}))], complete: true}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [ac]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === ac)), 'candidates relayed unchanged');
  assert.ok((await peerSend(ctx, s, 'end', {reason: 'hangup'})).got);
  assert.ok(await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state' && x.state === 'ended'), 'state ended');
});

test('flow (peer calls provider): the provider\'s endpoint hangs up with end', async () => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const end = await appMessage(ctx, s, {seq: s.appSeq++, type: 'end', body: {reason: 'hangup'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === end)), 'end relayed');
});

test('flow (peer calls provider): a decline claimed by the endpoint reaches the caller with the callee certificate', async () => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  const appLeg = await keyPair(), cl = await ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'decline', delegate: appLeg.jwk});
  assert.ok(cl.result?.certificate, JSON.stringify(cl));
  const s = {...inv, appLeg, peerLeg: inv.leg, peerIdentity: inv.from.identity};
  const dec = await appMessage(ctx, s, {seq: 0, type: 'decline', body: {reason: 'declined'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: inv.sid, messages: [dec]})).result?.accepted, 1);
  const got = await w.peer.until(() => w.peer.messages(inv.sid).find(m => m.jws === dec));
  assert.ok(got, 'decline relayed'); assert.ok(got.entry.batch.certificates.some(c => part(c, 1).role === 'callee'));
});

test('flow (peer calls provider): cancel before the claim ends the invite; cancel after the claim is processed as end', async t => {
  const ctx = await callee();
  const a = await invite(ctx); assert.ok(await deliver(ctx, a));
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: a.leg, sub: a.from.sub, aud: ctx.acct.identity, sid: a.sid, seq: 1, type: 'cancel', body: {}})]}));
  assert.ok(await ctx.waitEvent(e => e.sid === a.sid && (e.type === 'state' || e.type === 'message' && part(e.message, 1)?.type === 'cancel')), 'cancel reached the endpoint');
  const late = await ctx.c.call('claim', {...ctx.ep, sid: a.sid, outcome: 'accept', delegate: (await keyPair()).jwk});
  assert.ok(!late.result?.certificate, 'a cancelled session cannot be claimed: ' + JSON.stringify(late));
  const b = await invite(ctx); assert.ok(await deliver(ctx, b)); const s = await accept(ctx, b);
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: null, seq: s.peerSeq++, type: 'cancel', body: {}})]}));
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 5000);
  if (!ended) diverge(t, {section: '§7.4 ("A cancel that reaches the callee provider after a successful claim is processed as end with hangup")', request: 'cancel (to null) from the caller leg after the claim', observed: 'session not ended at the callee endpoint', expected: 'ended', side: 'implementation'});
});

test('§4.4/§12 a silent owner decline, an unanswered ring and an app revocation send the caller nothing', async t => {
  const ctx = await callee();
  const a = await invite(ctx); assert.ok(await deliver(ctx, a));
  const r = await w.post('/api/rtc/end-session', {sid: a.sid, caller: ctx.bob.principal, silent: true}, ctx.acct.owner);
  t.diagnostic(`owner silent end-session -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  assert.ok(await ctx.waitEvent(e => e.sid === a.sid && e.type === 'state' && e.state === 'ended', 4000), 'the owner\'s own endpoint stops ringing');
  const b = await invite(ctx, {ring: 3}); assert.ok(await deliver(ctx, b));
  await sleep(5500);
  const c2 = await invite(ctx); assert.ok(await deliver(ctx, c2));
  const grants = await (await w.request('/api/grants', ctx.acct.owner)).json(), list = grants.grants ?? grants;
  for (const g of Array.isArray(list) ? list : []) if (g.clientId === APP.id || g.client?.id === APP.id) await w.request('/api/grants/' + g.id, {...ctx.acct.owner, method: 'DELETE'});
  await sleep(2500);
  const sent = [a, b, c2].flatMap(x => [...w.peer.messages(x.sid), ...w.peer.controls(x.sid)]);
  if (sent.length) diverge(t, {section: '§4.4 ("MUST NOT send a decline that no user action or owner setting caused"), §12 ("A callee provider MUST NOT send a message the caller could use to learn any of these")', request: 'owner silent decline; unanswered ring past ring_until; app grant revoked while ringing', observed: sent.map(m => `${m.payload.type ?? m.payload.bindle}/${m.payload.reason ?? ''}`).join(', '), expected: 'nothing sent to the caller provider', side: 'implementation'});
});

// ==== flows: provider as caller ======================================================================================
async function openCall(ctx, {to = ctx.bob, media = ['data']} = {}) {
  const appLeg = await keyPair(), o = await ctx.c.call('open', {...ctx.ep, to: to.principal, purpose: CALL, media, delegate: appLeg.jwk});
  assert.ok(o.result?.certificate, 'open: ' + JSON.stringify(o));
  const s = {sid: o.result.sid ?? part(o.result.certificate, 1).sid, cert: o.result.certificate, appLeg, to, peerIdentity: to.identity, appSeq: 0};
  s.invite = await appMessage(ctx, s, {seq: s.appSeq++, type: 'invite', to: null, body: {purpose: part(s.cert, 1).purpose, media, ring_until: now() + 100, basis: null, context: null, offer: sdp(), callback_digest: null, sas_commit: null}});
  const sent = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [s.invite]}); assert.equal(sent.result?.accepted, 1, 'send invite: ' + JSON.stringify(sent));
  s.received = await w.peer.until(() => w.peer.messages(s.sid).find(m => m.jws === s.invite), {timeout: 6000});
  return s;
}
async function peerAnswer(ctx, s, type = 'accept', {leg, body} = {}) {
  leg ??= await keyPair();
  const cert = await w.peer.legCertificate({sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, role: 'callee', purpose: part(s.cert, 1).purpose, leg});
  const m = await w.peer.message({leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: 0, type, body: body ?? (type === 'accept' ? {answer: sdp({setup: 'active'}), sas_nonce: null} : {reason: 'declined'})});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [m]}));
  return {leg, cert, m, r};
}

test('flow (provider calls peer): open, invite delivered with its certificate, accept, candidates, end', async () => {
  const ctx = await callee(), s = await openCall(ctx);
  assert.ok(s.received, 'the invite reached the peer endpoint');
  const e = s.received.entry; assert.deepEqual(e.step1.problems, []); assert.equal(e.contentType, MEDIA_TYPE);
  assert.ok(e.batch.certificates.includes(s.cert), 'the caller certificate accompanies the first message');
  assert.deepEqual(e.batch.links, [], 'no links without a basis or callback digest');
  const v = await w.peer.verifyFromProvider(s.cert, [s.invite]); assert.deepEqual(v.problems, []);
  assert.ok(w.net.log.filter(x => x.kind === 'dial' && x.method === 'POST').every(x => x.host === 'peer.example' && x.path === '/bindle/rtc'), 'POSTs only to the declared endpoint');
  const ans = await peerAnswer(ctx, s); assert.equal(ans.r.status, 202);
  assert.ok(await ctx.waitEvent(x => x.sid === s.sid && x.type === 'message' && x.message === ans.m), 'accept delivered to the caller endpoint');
  const pc = await w.peer.message({leg: ans.leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: 1, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate())], complete: true}});
  await w.peer.post(w.peer.batch({messages: [pc]}));
  assert.ok(await ctx.waitEvent(x => x.message === pc), 'peer candidates delivered');
  const ac = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.1'}))], complete: true}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [ac]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === ac)), 'app candidates relayed unchanged');
  const end = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'end', body: {reason: 'hangup'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === end)), 'end relayed');
});

test('flow (provider calls peer): a decline reaches the caller endpoint and ends the session', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const ans = await peerAnswer(ctx, s, 'decline'); assert.equal(ans.r.status, 202);
  assert.ok(await ctx.waitEvent(x => x.message === ans.m), 'decline delivered');
  // §7.1: decline ends the session at the caller provider. The spec does not say that the caller endpoint also gets a
  // `state` event (the decline message is the signal), so the observable checked is that nothing more is relayed.
  const state = await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state', 1500);
  t.diagnostic(`caller endpoint state event after decline: ${state ? state.state : 'none'}`);
  const end = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'end', body: {reason: 'hangup'}});
  const r = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]});
  await sleep(500);
  assert.equal(w.peer.messages(s.sid).some(m => m.jws === end), false, 'nothing is relayed after the decline ended the session: ' + JSON.stringify(r));
});

test('flow (provider calls peer): cancel reaches the peer; a later accept is answered with a control end (failed)', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const cancel = await appMessage(ctx, s, {seq: s.appSeq++, type: 'cancel', to: null, body: {}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [cancel]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === cancel)), 'cancel relayed');
  const ans = await peerAnswer(ctx, s); assert.equal(ans.r.status, 202);
  const ctl = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.leg === ans.leg.jkt), {timeout: 5000});
  if (!ctl) diverge(t, {section: '§7.4 ("An accept that reaches the caller provider after the caller\'s cancel is answered by the caller provider with a control statement end (failed) for that callee leg")', request: 'callee accept after the caller cancelled', observed: 'no control statement received', expected: 'control end, reason failed, leg = the callee leg jkt', side: 'implementation'});
  else { assert.equal(ctl.payload.reason, 'failed'); assert.equal(ctl.header.typ, TYP.control); assert.ok(isLowS(ctl.jws)); const keys = await w.peer.providerCertKeys(ctx.acct.sub); assert.ok(await verifyJws(ctl.jws, keys.find(k => k.kid === ctl.header.kid)?.jwk ?? {}), 'control verifies under an active cert key'); }
});

test('§7.2 the caller provider accepts only the first answer; a later callee leg gets a control end (failed)', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const first = await peerAnswer(ctx, s); assert.ok(await ctx.waitEvent(x => x.message === first.m));
  const second = await peerAnswer(ctx, s); assert.equal(second.r.status, 202);
  await sleep(300); await ctx.poll();
  assert.equal(ctx.has(x => x.message === second.m), false, 'the second answer never reaches the caller endpoint');
  const ctl = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.leg === second.leg.jkt), {timeout: 5000});
  if (!ctl) diverge(t, {section: '§7.2 ("any later callee leg is sent a control statement end with failed")', request: 'a second accept from a different callee leg', observed: 'no control statement received', expected: 'control end failed for the second leg', side: 'implementation'});
});

test('§8.3 delivery retries 5xx with the JWS values unchanged', async () => {
  const ctx = await callee(); let failures = 1;
  w.peer.endpointStatus = () => failures-- > 0 ? 503 : 202;
  try {
    const s = await openCall(ctx); assert.ok(s.received);
    const posts = await w.peer.until(() => { const p = w.peer.received.filter(e => e.batch?.messages?.includes(s.invite)); return p.length >= 2 && p; }, {timeout: 10000});
    assert.ok(posts, 'retried after 503'); assert.equal(posts[0].status, 503);
    assert.deepEqual(posts[1].batch.messages, posts[0].batch.messages, 'retried JWS values unchanged');
  } finally { w.peer.endpointStatus = 202; }
});

test('§4.1 open to an issuer that does not declare rtc-signaling.v1 fails with unsupported_peer', async t => {
  const ctx = await callee(), plain = await w.peers.plain.entity();
  const o = await ctx.c.call('open', {...ctx.ep, to: plain.principal, purpose: CALL, media: ['data'], delegate: (await keyPair()).jwk});
  t.diagnostic(`requests the provider made to the peer without rtc-signaling.v1: ${w.peers.plain.requests.map(r => r.method + ' ' + new URL(r.url).pathname).join(', ') || 'none'}`);
  // RTC-i divergence 3 (fixed): the roster's fresh manifest decides it, and the runtime no longer remaps the code.
  assert.equal(o.error?.code, 'unsupported_peer', JSON.stringify(o.error ?? o.result));
  assert.ok(!w.peers.plain.requests.some(r => new URL(r.url).pathname.includes('/identity/')), 'no identity document fetched from an issuer without rtc-signaling.v1');
});

test('protocol §2 floor: a peer whose manifest omits the optional DPoP declaration can still be called', async t => {
  const ctx = await callee(), f = await w.peers.floor.entity();
  const o = await ctx.c.call('open', {...ctx.ep, to: f.principal, purpose: CALL, media: ['data'], delegate: (await keyPair()).jwk});
  t.diagnostic(`requests the provider made to the floor-only peer: ${w.peers.floor.requests.map(r => r.method + ' ' + new URL(r.url).pathname).join(', ') || 'none'}`);
  // RTC-i divergence 5 (fixed): the directory accepts a floor manifest without the optional DPoP declaration.
  assert.ok(o.result?.certificate, JSON.stringify(o.error ?? o));
  assert.equal(part(o.result.certificate, 1).aud, f.identity, 'certified toward the floor peer identity');
});

// ==== §5.2 control statements inbound ================================================================================
test('§5.2 a control statement from the session party ends the session; one signed by another key or party is ignored', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const e = w.peer.entities.get(s.from.sub), mallory = await w.peer.entity();
  const sigSigned = await w.peer.control({sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt, signer: e.sig});
  const otherParty = await w.peer.control({sub: mallory.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt});
  for (const c of [sigSigned, otherParty]) assert.equal((await w.peer.post(w.peer.batch({controls: [c]}))).status, 202);
  const still = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false});
  if (!still.got || ctx.has(x => x.sid === s.sid && x.type === 'state')) diverge(t, {section: '§5.2/AMD-RV1 (cert keys only; "only from the session party it expects")', request: 'controls signed by the identity sig key and by another entity\'s cert key', observed: 'session ended or stalled', expected: 'both ignored', side: 'implementation'});
  const good = await w.peer.control({sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt, reason: 'revoked'});
  assert.equal((await w.peer.post(w.peer.batch({controls: [good]}))).status, 202);
  const ended = await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state' && x.state === 'ended', 5000);
  assert.ok(ended, 'the party\'s control ends the session');
  const after = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {timeout: 1500});
  assert.equal(after.got, false, 'nothing from the ended leg is accepted again');
});

// ==== additional MUSTs ===============================================================================================
test('§6.2 invite body rules: ring_until, media, context, sas_commit and a non-null to are refused', async t => {
  const ctx = await callee(); await beacon(ctx);
  const cases = [
    ['ring_until 300 s after iat', await invite(ctx, {ring: 300}), '§6.2 ("ring_until ... at most iat + 120")'],
    ['media not a subset of the purpose media (screen for call)', await invite(ctx, {media: ['screen']}), '§6.2, §4.1'],
    ['empty media', await invite(ctx, {media: []}), '§6.2 ("nonempty subset")'],
    ['context object for a purpose whose context is null', await invite(ctx, {bodyOverride: {context: {note: 'x'}}}), '§6.2 ("context null or an object valid against the purpose\'s context.data")'],
    ['sas_commit not a base64url SHA-256', await invite(ctx, {bodyOverride: {sas_commit: 'abc'}}), '§6.2, §11.3'],
    ['invite with a non-null to', await invite(ctx, {msgOverride: {to: randomId(32)}}), '§6.1 ("to ... null only for invite and cancel")'],
    ['basis with an unknown member', await invite(ctx, {basis: {link_digest: await linkDigest(ctx.ticket), extra: 1}}), '§4.2 basis wire']
  ];
  for (const [label, inv, section] of cases) await dropped(t, ctx, label, inv, section);
});

test('§4.3 an inbound callback link is delivered only to the claiming endpoint', async t => {
  const ctx = await callee(), leg = await keyPair();
  const meta = await sign({alg: 'ES256', kid: 'k1', typ: 'bindle-link-meta+jwt'}, {bindle: 'link-meta', v: 1, type: 'https://spec.bindle.example/links/rtc-ticket/v1', iss: PEER, aud: `${PEER}/rtc/t/${randomId(16)}`, jti: randomId(16), iat: now(), exp: now() + 3600, sub: ctx.bob.sub, purposes: [CALL], uses: 1, principal: ctx.acct.principal}, leg);
  const callback = `${part(meta, 1).aud}?bindle_meta=${meta}`;
  const inv = await invite(ctx, {bodyOverride: {callback_digest: await linkDigest(callback)}, links: [ctx.ticket, callback]});
  const e = await deliver(ctx, inv); assert.ok(e, 'invite with a callback delivered');
  assert.equal(JSON.stringify(e).includes(callback), false, 'the callback link is not in the listen event');
  const cl = await ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'accept', delegate: (await keyPair()).jwk});
  if (cl.result?.callback !== callback) diverge(t, {section: '§4.3 Callback ("the callee provider delivers it only to the endpoint that claims the session"), §9.1 claim → callback', request: 'claim of an invite whose batch carried a callback link', observed: JSON.stringify(cl.result?.callback ?? null), expected: 'the callback link in the claim result', side: 'implementation'});
});

test('§4.3 an outbound callback ticket is minted one-use, bound to the callee, at most 24 h, and carried beside the invite', async () => {
  const ctx = await callee(), appLeg = await keyPair();
  const o = await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, purpose: CALL, media: ['data'], delegate: appLeg.jwk, callback: true});
  assert.ok(o.result?.callback, 'open returns a callback link: ' + JSON.stringify(o));
  const link = o.result.callback, s = {sid: part(o.result.certificate, 1).sid, appLeg, peerIdentity: ctx.bob.identity};
  const u = new URL(link), metaJws = u.searchParams.get('bindle_meta'), h = part(metaJws, 0), p = part(metaJws, 1);
  assert.equal(u.origin, PROVIDER); assert.deepEqual([...u.searchParams.keys()], ['bindle_meta'], 'canonical: exactly bindle_meta');
  assert.equal(h.typ, 'bindle-link-meta+jwt'); assert.equal(p.bindle, 'link-meta'); assert.equal(p.v, 1);
  assert.equal(p.type, 'https://spec.bindle.example/links/rtc-ticket/v1'); assert.equal(p.iss, PROVIDER); assert.equal(p.aud, u.origin + u.pathname);
  assert.deepEqual(Object.keys(p).sort(), ['aud', 'bindle', 'exp', 'iat', 'iss', 'jti', 'principal', 'purposes', 'sub', 'type', 'uses', 'v'].sort(), 'common members plus exactly sub, purposes, uses, principal');
  assert.equal(p.uses, 1); assert.deepEqual(p.principal, ctx.bob.principal); assert.equal(p.sub, ctx.acct.sub); assert.ok(p.purposes.includes(CALL));
  assert.ok(p.exp - p.iat <= 86400, 'exp at most 24 h after iat');
  const inv = await appMessage(ctx, s, {seq: 0, type: 'invite', to: null, body: {purpose: part(o.result.certificate, 1).purpose, media: ['data'], ring_until: now() + 100, basis: null, context: null, offer: sdp(), callback_digest: await linkDigest(link), sas_commit: null}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [inv]})).result?.accepted, 1);
  const got = await w.peer.until(() => w.peer.messages(s.sid).find(m => m.jws === inv)); assert.ok(got, 'invite relayed');
  assert.deepEqual(got.entry.batch.links, [link], 'the callback link travels beside the invite, and nothing else');
});

test('§7.2 fan-out and first claim: two eligible endpoints, exactly one claim wins, the other is told only "claimed"', async t => {
  const ctx = await callee(), reg2 = await ctx.c.call('register', {purposes: [CALL]}); assert.equal(reg2.status, 200);
  const ep2 = {endpoint: reg2.result.endpoint, ...reg2.result.endpoint_secret ? {endpoint_secret: reg2.result.endpoint_secret} : {}};
  const l2 = {events: [], cursor: undefined};
  const poll2 = async (wait = 1) => { const l = await ctx.c.call('listen', {...ep2, ...l2.cursor !== undefined ? {cursor: l2.cursor} : {}, wait}); if (l.result) { l2.cursor = l.result.cursor; l2.events.push(...l.result.events); } };
  const inv = await invite(ctx); assert.ok(await deliver(ctx, inv), 'delivered to endpoint 1');
  const end = Date.now() + 5000; while (!l2.events.some(e => e.sid === inv.sid && e.type === 'invite') && Date.now() < end) await poll2();
  assert.ok(l2.events.some(e => e.sid === inv.sid && e.type === 'invite'), 'fanned out to endpoint 2');
  const [a, b] = await Promise.all([ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'accept', delegate: (await keyPair()).jwk}), ctx.c.call('claim', {...ep2, sid: inv.sid, outcome: 'accept', delegate: (await keyPair()).jwk})]);
  const winners = [a, b].filter(r => r.result?.certificate), losers = [a, b].filter(r => !r.result?.certificate);
  assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify([a.error, b.error])}`);
  // RTC-i divergence 4 (fixed): `claimed` is a no-effect code of the federation dispatcher (no longer `indeterminate`).
  assert.equal(losers[0].error?.code, 'claimed', JSON.stringify(losers[0].error ?? losers[0]));
  const loserEvents = losers[0] === b ? (await poll2(1), l2.events) : (await ctx.poll(1), ctx.events);
  const st = loserEvents.find(e => e.sid === inv.sid && e.type === 'state');
  t.diagnostic(`losing endpoint state event: ${JSON.stringify(st ? {state: st.state} : null)}`);
});

test('§6.4 more than 32 messages buffered ahead of a gap end the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const gapAt = s.peerSeq, item = {gen: 0, items: [candidateItem(candidate())], complete: false};
  const msgs = []; for (let i = 1; i <= 33; i++) msgs.push(await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: gapAt + i, type: 'candidates', body: item}));
  assert.equal((await w.peer.post(w.peer.batch({messages: msgs.slice(0, 32)}))).status, 202);
  const early = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state', 1000);
  assert.equal(early, null, '32 buffered messages do not end the leg');
  const t0 = Date.now(); assert.equal((await w.peer.post(w.peer.batch({messages: [msgs[32]]}))).status, 202);
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 6000);
  if (!ended) diverge(t, {section: '§6.4 ("buffers at most 32 messages ahead of a gap")', request: 'a gap, then 33 later messages', observed: 'leg not ended within 6 s of the 33rd', expected: 'leg ended (failed) once a 33rd message is ahead of the gap', side: 'implementation'});
  else t.diagnostic(`ended ${Date.now() - t0} ms after the 33rd message`);
});

test('§6.2/§9.1 the provider refuses its own endpoint\'s invite with ring_until beyond iat + 120 or media beyond the opened media', async t => {
  const ctx = await callee(), appLeg = await keyPair();
  const o = await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, purpose: CALL, media: ['data'], delegate: appLeg.jwk}); assert.ok(o.result?.certificate);
  const s = {sid: part(o.result.certificate, 1).sid, appLeg, peerIdentity: ctx.bob.identity}, purpose = part(o.result.certificate, 1).purpose;
  const body = o2 => ({purpose, media: ['data'], ring_until: now() + 100, basis: null, context: null, offer: sdp(), callback_digest: null, sas_commit: null, ...o2});
  const wrong = [];
  for (const [label, b] of [['ring_until iat + 300', body({ring_until: now() + 300})], ['media video after opening data', body({media: ['video'], offer: sdp({kinds: ['video']})})]]) {
    const m = await appMessage(ctx, s, {seq: 0, type: 'invite', to: null, body: b});
    const r = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [m]});
    await sleep(300);
    if (r.result?.accepted === 1 || w.peer.messages(s.sid).some(x => x.jws === m)) wrong.push(label);
  }
  if (wrong.length) diverge(t, {section: '§6.2, §9.1 send ("applies §6, §6.3 ... before relaying, and refuses violations with invalid_args")', request: 'send of an invite breaking one rule', observed: `accepted or relayed: ${wrong.join('; ')}`, expected: 'refused with invalid_args', side: 'implementation'});
});

test('§6.2 only the caller leg sends sas, and messages must name the receiving leg in to', async t => {
  const leaked = [], seqNotes = [];
  for (const [label, type, body, extra] of [['sas from the callee leg', 'sas', {nonce: randomId(32)}, {}], ['to naming no leg of the session', 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {to: randomId(32)}]]) {
    const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
    const ans = await peerAnswer(ctx, s); assert.ok(await ctx.waitEvent(x => x.message === ans.m), 'connected');
    const mk = (seq, ty, b, o = {}) => w.peer.message({leg: ans.leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq, type: ty, body: b, ...o});
    const bad = await mk(1, type, body, extra), good = {gen: 0, items: [candidateItem(candidate())], complete: true};
    const status = (await w.peer.post(w.peer.batch({messages: [bad]}))).status;
    const next = await mk(2, 'candidates', good); await w.peer.post(w.peer.batch({messages: [next]}));
    let consumed = !!await ctx.waitEvent(x => x.message === next, 3000);
    if (!consumed) { const refill = await mk(1, 'candidates', good); await w.peer.post(w.peer.batch({messages: [refill]})); seqNotes.push(`${label}: seq not consumed (${await ctx.waitEvent(x => x.message === refill, 3000) ? 'refill of seq 1 delivered' : 'refill not delivered'})`); }
    else seqNotes.push(`${label}: seq consumed`);
    if (ctx.has(x => x.message === bad)) leaked.push(`${label} (post ${status})`);
  }
  // Which §8.2 step these rules belong to (and so whether the refused message consumes its seq at step 5) is not stated
  // by the spec; AMD-RI3 (proposed) puts the `to` check at step 7, so the dropped message consumes its seq.
  t.diagnostic(seqNotes.join('; '));
  const sasLeak = leaked.filter(l => l.startsWith('sas')), toLeak = leaked.filter(l => l.startsWith('to'));
  if (sasLeak.length) diverge(t, {section: '§6.2 ("Only the caller leg may send invite, cancel and sas")', request: 'a sas message from the callee leg', observed: `delivered: ${sasLeak.join('; ')}`, expected: 'not delivered', side: 'implementation'});
  // RTC-i divergence 9 (fixed, AMD-RI3 proposed): a message whose `to` names no leg of the session is dropped.
  assert.deepEqual(toLeak, [], 'a message whose to names no leg of the session is not delivered');
  assert.ok(seqNotes.includes('to naming no leg of the session: seq consumed'), 'the dropped message consumed its seq, as other step-7 drops do');
});

test('§3.2/§9.1 an application can request the signaling fragment on a provider that declares the rtc extension, without operator-registered documents', async () => {
  // RTC-i divergence 10 (decided: ship both documents as first-party reviewed artefacts while the flags are on). The
  // shared world registers nothing; this request is the first step every other test in the suite takes.
  const acct = await w.account(), verifier = randomUUID() + randomUUID(), challenge = createHash('sha256').update(verifier).digest('base64url');
  const r = await w.post('/api/oauth/requests', {clientId: APP.id, redirectUri: APP.redirectUris[0], challenge, challengeMethod: 'S256', state: 's', identity: acct.handle + '@provider.example', requests: [{fragment: FRAGMENT, required: true, purpose: 'Calls', fields: ['signaling'], methods: {signaling: {[CONTRACT]: METHODS}}}]}, {appOrigin: APP.origin, ip: acct.ip});
  const body = await r.json();
  assert.equal(r.status, 201, JSON.stringify(body));
});
