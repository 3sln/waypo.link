// A CLEAN-ROOM conformance peer for the signaling extension (docs/spec/extensions/signaling.md, signaling.v1 rev 3.2).
//
// MINIMAL RETARGET (signaling §21.2 "Carries over, with renames only"), not the step-6 rewrite: this peer was written
// only from the superseded rtc-signaling text (RTC-i) and has been renamed onto the rev 3.2 wire: the `typ` values,
// the `bindle` magic, the media type, the endpoint path, the `role` values (initiator/recipient), `ring_until` ->
// `answer_by`, `purpose` -> `kind` {artefact, version, digest} plus `profile`, the invite `params` {offer} and accept
// `params` {answer} (webrtc, §16.3), the batch `offers` member (§9.1), and no `media`, SAS, callback or link members.
// Spec sources: signaling.md §3.1, §6, §7, §9, §16; keys.md §3 (the compact JWS profile); organizations.md §3a
// (directory.v1, identity documents, certification keys) and §5.2 (`cnf`, `delegate`, `aep`); protocol.md §2 (the
// manifest floor) and extensions.md §2. It imports NO 3sln.me code: raw WebCrypto, its own base64url, its own SDP and
// candidate builders, plain fetch-like handlers. It plays a minimal "second provider":
//
// - it publishes a manifest declaring, in the extensions revision 3.2 shape (`extensions: [{spec, options}]`), the
//   directory extension, the artefact-versions extension and the signaling extension with its `profiles` (§3.1), a
//   `?sub=` / `?handle=` directory and identity documents with one `sig` key and one `cert` key per entity. It
//   declares no intents or intent-links extension (§3.1: a peer never requires one);
// - it issues leg certificates (§6.1), control statements (§6.2) and messages (§7) signed ES256 with low-S signatures
//   (§6.3), and can deliberately break any rule for negative tests;
// - its `handler` serves those documents and accepts §9.1 batches at its endpoint, verifying them as §9.2 step 1 and
//   steps 3-4 describe (with the sending provider's keys fetched from that provider's own directory);
// - it holds no offers: when the provider under test dials back on an offer "minted" here, the peer only invents a
//   token of the §5.7 shape (`mintOffer`), since the provider under test cannot check it (§5.7 "Dialing back");
// - `nodeNetwork` is the only seam into the provider under test: a DNS answer and a socket replacement for the
//   provider's injected `DIRECTORY_DNS_LOOKUP` / `DIRECTORY_HTTPS_REQUEST` ports, so the provider's real screening and
//   egress code run and only the wire is simulated. Nothing here is evidence of production behaviour.
//
// Not implemented here (left for the step-6 rewrite, §21.2 "The peer itself needs"): a `data`-profile client, the
// relation basis, its own offer records (admission at this peer), glare, and verification of provider-sent offers
// beyond their shape.

export const SPEC = 'https://spec.bindle.example';
/** Extension spec URLs (extensions rev 3.2 §2.8 placeholders; signaling §3.1). */
export const EXT = { directory: `${SPEC}/extensions/directory/v1`, artefactVersions: `${SPEC}/extensions/artefact-versions/v1`, signaling: `${SPEC}/extensions/signaling/v1` };
/** The options of extension `spec` in a manifest (undefined when not declared). */
export const extensionOptions = (m, spec) => (Array.isArray(m?.extensions) ? m.extensions : []).find(e => e?.spec === spec)?.options;
/** §9.1 media type; §6.1, §6.2, §7.1 `typ` values and the matching `bindle` magic. */
export const MEDIA_TYPE = 'application/vnd.bindle.signaling+json';
export const TYP = { cert: 'bindle-signaling-leg+jwt', control: 'bindle-signaling-control+jwt', message: 'bindle-signaling-message+jwt' };
export const MAGIC = { cert: 'signaling-leg-certificate', control: 'signaling-control', message: 'signaling-message' };
/** §3.5: the registered profiles (this peer relays only `webrtc`). */
export const PROFILES = ['data', 'webrtc'];
const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n, HALF_N = N >> 1n;

// ---- encoding -------------------------------------------------------------------------------------------------------
export const utf8 = text => new TextEncoder().encode(text);
export const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
export const segment = value => b64(utf8(typeof value === 'string' ? value : JSON.stringify(value)));
export const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? utf8(bytes) : bytes));
export const randomId = (bytes = 16) => b64(crypto.getRandomValues(new Uint8Array(bytes)));
export const now = () => Math.floor(Date.now() / 1000);
const big = bytes => BigInt('0x' + ([...bytes].map(b => b.toString(16).padStart(2, '0')).join('') || '0'));
const bytes32 = n => Uint8Array.from(n.toString(16).padStart(64, '0').match(/../g), h => parseInt(h, 16));

/** Decodes one segment of a compact JWS (no verification). */
export function part(jws, index) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unb64(jws.split('.')[index]))); } catch { return null; } }

// ---- keys and JWS ---------------------------------------------------------------------------------------------------
export async function keyPair() {
  const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x, y };
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, jwk, jkt: await thumbprint(jwk), kid: randomId(12) };
}
/** RFC 7638 thumbprint of a P-256 JWK (members in lexicographic order). */
export async function thumbprint(jwk) { return b64(await sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))); }

/** Raw r||s; `s` normalized to low-S (AMD-RV1) unless `highS` asks for the other compact form of the same signature. */
export async function signRaw(privateKey, input, { highS = false } = {}) {
  const sig = new Uint8Array(await crypto.subtle.sign(ES256, privateKey, utf8(input)));
  let s = big(sig.slice(32));
  if (s > HALF_N !== highS) s = N - s;
  return Uint8Array.from([...sig.slice(0, 32), ...bytes32(s)]);
}
/** Compact JWS over exactly the given header and payload objects (or raw strings, for malformed-JSON tests). */
export async function sign(header, payload, key, options = {}) {
  const input = `${segment(header)}.${segment(payload)}`;
  return `${input}.${b64(await signRaw(key.privateKey, input, options))}`;
}
/** Re-encodes the signature of `jws` with s' = n - s: the same signature in its other (high or low) form. */
export function malleate(jws) {
  const [h, p, s] = jws.split('.'), raw = unb64(s);
  return `${h}.${p}.${b64(Uint8Array.from([...raw.slice(0, 32), ...bytes32(N - big(raw.slice(32)))]))}`;
}
export const isLowS = jws => big(unb64(jws.split('.')[2]).slice(32)) <= HALF_N;
export async function verifyJws(jws, jwk) {
  const [h, p, s] = jws.split('.'); const raw = unb64(s); if (raw.length !== 64) return false;
  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, P256, false, ['verify']);
  return crypto.subtle.verify(ES256, key, raw, utf8(`${h}.${p}`));
}

// ---- SDP and candidates (§16.4) -------------------------------------------------------------------------------------
const MLINE = { audio: 'm=audio 9 UDP/TLS/RTP/SAVPF 111', video: 'm=video 9 UDP/TLS/RTP/SAVPF 96', application: 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', text: 'm=text 9 UDP/TLS/RTP/SAVPF 98' };
export const fingerprint = (seed = 0xab) => Array.from({ length: 32 }, (_, i) => ((seed + i * 7) & 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
/**
 * A §16.4-valid SDP: CRLF, `a=ice-options:trickle`, no candidate lines, `c=` 0.0.0.0, `o=` `-` and digits with 127.0.0.1,
 * one sha-256 fingerprint, no u=/e=/p= lines. Options inject single violations.
 */
export function sdp({ kinds = ['application'], setup = 'actpass', fp = fingerprint(), mediaFp = null, extra = [], mediaExtra = [], origin = 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', connection = 'c=IN IP4 0.0.0.0', trickle = true, eol = '\r\n', omitFingerprint = false } = {}) {
  const lines = ['v=0', origin, 's=-', 't=0 0', `a=group:BUNDLE ${kinds.map((_, i) => i).join(' ')}`, ...(trickle ? ['a=ice-options:trickle'] : []), ...(omitFingerprint ? [] : [`a=fingerprint:sha-256 ${fp}`]), ...extra];
  kinds.forEach((kind, i) => {
    lines.push(MLINE[kind], connection, 'a=ice-ufrag:Qw3r', 'a=ice-pwd:Zx8vKq2mPl9nRt4wYb6hJs', `a=setup:${setup}`, `a=mid:${i}`);
    if (mediaFp) lines.push(`a=fingerprint:sha-256 ${mediaFp}`);
    lines.push(...(kind === 'application' ? ['a=sctp-port:5000'] : ['a=sendrecv', 'a=rtcp-mux']), ...mediaExtra);
  });
  return lines.join(eol) + eol;
}
export const mdns = () => `${crypto.randomUUID()}.local`;
export const candidate = ({ typ = 'relay', address = '34.120.17.9', port = 3478, raddr, rport, extra = '' } = {}) =>
  `candidate:1 1 udp 41885439 ${address} ${port} typ ${typ}${raddr !== undefined ? ` raddr ${raddr} rport ${rport ?? 0}` : ''}${extra}`;
export const candidateItem = (c, mid = '0') => ({ candidate: c, sdpMid: mid, sdpMLineIndex: 0, usernameFragment: 'Qw3r' });

// ---- the peer provider ----------------------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {string} o.origin       the peer issuer origin (https, no port: the provider's egress dials :443 only)
 * @param {(url:string, init?:object)=>Promise<Response>} o.providerFetch  how the peer reaches the provider under test
 *        (its manifest, directory, identity documents and the signaling declaration's `endpoint`)
 * @param {boolean} o.signaling   publish the signaling declaration (false: an issuer without one, §5.1 `unsupported_peer`)
 * @param {string[]} o.profiles   the declaration's `profiles` option (§3.1)
 */
export async function createPeer({ origin = 'https://peer.example', providerFetch, maxLegSeconds = 600, dpop = true, endpointPath = '/bindle/signaling', signaling = true, profiles = ['webrtc'] } = {}) {
  const entities = new Map(), received = [], requests = [];
  const manifest = {
    version: '0', issuer: origin,
    authorization_request_endpoint: `${origin}/oauth/requests`, authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`, rpc_endpoint: `${origin}/bindle/rpc`, jwks_uri: `${origin}/oauth/jwks`,
    preferences_contract: 'https://3sln.me/artefacts/contracts/preferences/v1', login_presentation: ['redirect'],
    // Optional under protocol §2 ("every ... DPoP declaration is optional"); `dpop: false` publishes the bare floor.
    ...dpop ? { dpop_signing_alg_values_supported: ['ES256'] } : {},
    extensions: [
      { spec: EXT.directory, options: { directory_url: `${origin}/bindle/directory` } },
      { spec: EXT.artefactVersions, options: {} },
      ...signaling ? [{ spec: EXT.signaling, options: { endpoint: `${origin}${endpointPath}`, max_leg_certificate_seconds: maxLegSeconds, profiles } }] : []
    ]
  };
  const identity = sub => `${origin}/identity/${sub}`;
  const peer = { origin, manifest, entities, received, requests, identity, endpointStatus: 202 };

  /** Creates (or returns) a hosted entity with one active `sig` and one active `cert` key (organizations §3a.3). */
  peer.entity = async (sub = crypto.randomUUID(), { handle } = {}) => {
    if (!entities.has(sub)) {
      const sig = await keyPair(), cert = await keyPair();
      entities.set(sub, { sub, handle: handle ?? `p${entities.size}@${new URL(origin).host}`, aep: 1, sig, certs: [{ ...cert, state: 'active' }] });
    }
    const e = entities.get(sub); return { ...e, iss: origin, identity: identity(sub), principal: { iss: origin, sub } };
  };
  const document = e => ({ v: 1, iss: origin, sub: e.sub, kind: 'person', keys: [
    { kid: e.sig.kid, use: 'sig', alg: 'ES256', jwk: e.sig.jwk, state: 'active', predecessor: null, continuity: null },
    ...e.certs.map(k => ({ kid: k.kid, use: 'cert', alg: 'ES256', jwk: k.jwk, state: k.state }))
  ] });
  peer.activeCert = sub => entities.get(sub).certs.find(k => k.state === 'active');
  peer.rotateCert = async sub => { const e = entities.get(sub); for (const k of e.certs) if (k.state === 'active') k.state = 'retired'; const next = await keyPair(); e.certs.push({ ...next, state: 'active' }); return next; };

  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300', ...headers } });
  const notFound = () => new Response('{"error":"not_found"}', { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

  /** The peer's HTTP surface (WHATWG Request in, Response out). */
  peer.handler = async request => {
    const url = new URL(request.url); requests.push({ method: request.method, url: url.href, at: Date.now() });
    if (url.origin !== origin) return notFound();
    if (request.method === 'GET' && url.pathname === '/.well-known/bindle/manifest.json') return json(manifest);
    if (request.method === 'GET' && url.pathname === '/bindle/directory') {
      const sub = url.searchParams.get('sub'), handle = url.searchParams.get('handle');
      const e = sub ? entities.get(sub) : [...entities.values()].find(x => x.handle === handle);
      return e ? json({ iss: origin, sub: e.sub, identity: identity(e.sub) }) : notFound();
    }
    const doc = /^\/identity\/([0-9a-f-]{36})\/identity\.json$/.exec(url.pathname);
    if (request.method === 'GET' && doc && entities.has(doc[1])) return json(document(entities.get(doc[1])), 200, { 'Access-Control-Allow-Origin': '*', 'Referrer-Policy': 'no-referrer' });
    if (url.pathname === endpointPath) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const text = await request.text(), entry = { at: Date.now(), contentType: request.headers.get('content-type'), bytes: utf8(text).length, text, batch: null, step1: null };
      try { entry.batch = JSON.parse(text); } catch {}
      entry.step1 = await peer.step1(entry.batch, { contentType: entry.contentType, bytes: entry.bytes, aud: aud => entities.has(aud.slice(`${origin}/identity/`.length)) || aud.startsWith(`${origin}/`) });
      received.push(entry); peer.onBatch?.(entry);
      entry.status = entry.step1.ok ? (typeof peer.endpointStatus === 'function' ? peer.endpointStatus(entry) : peer.endpointStatus) : 400;
      return new Response(null, { status: entry.status });
    }
    return notFound();
  };

  // ---- issuing ------------------------------------------------------------------------------------------------------
  /** A §6.1 leg certificate; `override` replaces payload members (`undefined` deletes one), `header` the header. */
  peer.legCertificate = async ({ sub, aud, sid, role, kind, profile = 'webrtc', client = { client_id: `${origin}/apps/conformance`, origin, feature: null }, leg, iat = now(), exp, aep, jti = randomId(), override = {}, header = {}, signer, highS = false }) => {
    const e = entities.get(sub), key = signer ?? peer.activeCert(sub);
    const payload = { bindle: MAGIC.cert, v: 1, iss: origin, sub, identity: identity(sub), aud, sid, role, kind, profile, client, cnf: { jkt: leg.jkt }, delegate: leg.jwk, aep: aep ?? e.aep, jti, iat, exp: exp ?? iat + maxLegSeconds };
    for (const [k, v] of Object.entries(override)) if (v === undefined) delete payload[k]; else payload[k] = v;
    const h = { alg: 'ES256', kid: key.kid, typ: TYP.cert, ...header }; for (const [k, v] of Object.entries(header)) if (v === undefined) delete h[k];
    return sign(h, payload, key, { highS });
  };
  /** A §7.1 message signed by the leg key. */
  peer.message = async ({ leg, sub, aud, sid, to = null, seq, type, body, iat = now(), override = {}, header = {}, highS = false, signer }) => {
    const payload = { bindle: MAGIC.message, v: 1, iss: origin, sub, aud, sid, leg: leg.jkt, to, seq, iat, type, body };
    for (const [k, v] of Object.entries(override)) if (v === undefined) delete payload[k]; else payload[k] = v;
    const h = { alg: 'ES256', typ: TYP.message, kid: leg.jkt, ...header }; for (const [k, v] of Object.entries(header)) if (v === undefined) delete h[k];
    return sign(h, payload, signer ?? leg, { highS });
  };
  /** A §6.2 control statement. */
  peer.control = async ({ sub, aud, sid, leg = null, reason = 'revoked', iat = now(), jti = randomId(), override = {}, header = {}, signer }) => {
    const key = signer ?? peer.activeCert(sub);
    const payload = { bindle: MAGIC.control, v: 1, iss: origin, sub, aud, sid, leg, type: 'end', reason, iat, jti };
    for (const [k, v] of Object.entries(override)) if (v === undefined) delete payload[k]; else payload[k] = v;
    return sign({ alg: 'ES256', kid: key.kid, typ: TYP.control, ...header }, payload, key);
  };
  /** A §9.1 batch; `offers` (the offer tokens of invites in the same batch) is omitted when empty. */
  peer.batch = ({ certificates = [], messages = [], controls = [], offers = [] } = {}) => ({ v: 1, certificates, messages, controls, ...offers.length ? { offers } : {} });
  /** An offer token of the §5.7 shape (at least 128 random bits, 22 to 43 base64url characters) for the provider under
   * test to dial back on. The peer keeps no offer record: admission at this peer is not implemented (step 6). */
  peer.mintOffer = () => randomId(32);

  // ---- talking to the provider under test ---------------------------------------------------------------------------
  let providerManifest = null; const providerKeys = new Map();
  peer.providerManifest = async () => providerManifest ??= await (await providerFetch('/.well-known/bindle/manifest.json')).json();
  /** POST a batch (object, or a raw string body) to the provider's declared signaling `endpoint` (§9.1). */
  peer.post = async (batch, { contentType = MEDIA_TYPE, path } = {}) => {
    const m = await peer.providerManifest(), endpoint = path ?? new URL(extensionOptions(m, EXT.signaling).endpoint).pathname;
    const res = await providerFetch(endpoint, { method: 'POST', headers: { 'Content-Type': contentType }, body: typeof batch === 'string' ? batch : JSON.stringify(batch) });
    return { status: res.status, body: await res.text(), headers: res.headers };
  };
  /** The provider entity's identity URI, from its directory only (organizations §3a.1: never constructed). */
  peer.lookup = async sub => {
    const m = await peer.providerManifest(), dir = new URL(extensionOptions(m, EXT.directory).directory_url);
    const res = await providerFetch(`${dir.pathname}?sub=${encodeURIComponent(sub)}`); if (res.status !== 200) return null;
    return res.json();
  };
  /** The provider entity's active certification keys, fetched from its identity document (§3a.3, §3a.5 steps 3–4). */
  peer.providerCertKeys = async sub => {
    const found = await peer.lookup(sub); if (!found) return [];
    const res = await providerFetch(new URL(found.identity + '/identity.json').pathname); if (res.status !== 200) return [];
    const doc = await res.json(); const keys = (doc.keys ?? []).filter(k => k.use === 'cert' && k.state === 'active');
    providerKeys.set(sub, { doc, keys, identity: found.identity }); return keys;
  };
  peer.providerDocument = sub => providerKeys.get(sub)?.doc;

  // ---- verification of what the provider sends (§9.2 step 1, §6.1 verifier rules, step 4) ---------------------------
  const EXACT = {
    cert: ['bindle', 'v', 'iss', 'sub', 'identity', 'aud', 'sid', 'role', 'kind', 'profile', 'client', 'cnf', 'delegate', 'aep', 'jti', 'iat', 'exp'],
    message: ['bindle', 'v', 'iss', 'sub', 'aud', 'sid', 'leg', 'to', 'seq', 'iat', 'type', 'body'],
    control: ['bindle', 'v', 'iss', 'sub', 'aud', 'sid', 'leg', 'type', 'reason', 'iat', 'jti']
  };
  // §7.2 generic types and the §16.3 webrtc profile types (no `data` client in this peer).
  const BODIES = { invite: ['kind', 'profile', 'answer_by', 'basis', 'context', 'params'], cancel: [], accept: ['params'], decline: ['reason'], end: ['reason'], sdp: ['gen', 'description'], candidates: ['gen', 'items', 'complete'] };
  const offerShape = /^[A-Za-z0-9_-]{22,43}$/;
  const same = (a, b) => a.length === b.length && [...a].sort().every((k, i) => k === [...b].sort()[i]);
  const jwsShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  /** §9.2 step 1 as this peer reads it: shape, bounds, JWS profile, typ/bindle/v, exact members, aud, iat window, and
   * the batch `offers` (each an offer token whose SHA-256 is the `offer_digest` of an invite in the same batch). Async
   * only for that digest. */
  peer.step1 = async (batch, { contentType, bytes, aud: audOk } = {}) => {
    const problems = [], t = now();
    if (contentType !== undefined && !String(contentType).toLowerCase().startsWith(MEDIA_TYPE)) problems.push('content-type');
    if (bytes !== undefined && bytes > 131072) problems.push('size');
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return { ok: false, problems: [...problems, 'not-object'] };
    if (!same(Object.keys(batch), ['v', 'certificates', 'messages', 'controls']) && !same(Object.keys(batch), ['v', 'certificates', 'messages', 'controls', 'offers'])) problems.push('batch-members');
    if (batch.v !== 1) problems.push('batch-v');
    const lists = { certificates: 4, messages: 32, controls: 4, ...Object.hasOwn(batch, 'offers') ? { offers: 4 } : {} };
    for (const [k, max] of Object.entries(lists)) if (!Array.isArray(batch[k]) || batch[k].length > max) problems.push(`${k}-bound`);
    if (problems.length) return { ok: false, problems };
    if (!batch.certificates.length && !batch.messages.length && !batch.controls.length) problems.push('empty');
    const check = (jws, kind) => {
      if (typeof jws !== 'string' || !jwsShape.test(jws)) return problems.push(`${kind}-compact`);
      if (kind === 'message' && jws.length > 40960) problems.push('message-size');
      const h = part(jws, 0), p = part(jws, 1);
      if (!h || !p) return problems.push(`${kind}-json`);
      if (unb64(jws.split('.')[2]).length !== 64) problems.push(`${kind}-sig-length`);
      if (!isLowS(jws)) problems.push(`${kind}-high-s`);
      if (!same(Object.keys(h), ['alg', 'kid', 'typ']) || h.alg !== 'ES256' || h.typ !== TYP[kind]) problems.push(`${kind}-header`);
      if (!same(Object.keys(p), EXACT[kind])) problems.push(`${kind}-members`);
      if (p.v !== 1 || p.bindle !== MAGIC[kind]) problems.push(`${kind}-bindle`);
      try { const a = new URL(p.aud); if (a.protocol !== 'https:' || a.username || a.search || a.hash || a.origin !== origin || audOk && !audOk(p.aud)) problems.push(`${kind}-aud`); } catch { problems.push(`${kind}-aud`); }
      if (kind === 'message') {
        if (!Number.isSafeInteger(p.iat) || p.iat < t - 120 || p.iat > t + 30) problems.push('message-iat');
        if (!Object.hasOwn(BODIES, p.type) || !p.body || typeof p.body !== 'object' || !same(Object.keys(p.body), BODIES[p.type])) problems.push('message-body');
        if (!Number.isSafeInteger(p.seq) || p.seq < 0 || p.seq > 4095) problems.push('message-seq');
        if (p.to === null && !['invite', 'cancel'].includes(p.type)) problems.push('message-to');
        if (typeof p.sid !== 'string' || !/^[A-Za-z0-9_-]{22,43}$/.test(p.sid)) problems.push('message-sid');
      }
      if (kind === 'cert' && (!Number.isSafeInteger(p.exp) || !Number.isSafeInteger(p.iat) || p.exp - p.iat > 900 || p.exp < t - 60)) problems.push('cert-lifetime');
    };
    for (const c of batch.certificates) check(c, 'cert');
    for (const m of batch.messages) check(m, 'message');
    for (const c of batch.controls) check(c, 'control');
    const digests = new Set(batch.messages.map(m => part(m, 1)).filter(p => p?.type === 'invite' && p.body?.basis?.offer_digest).map(p => p.body.basis.offer_digest));
    for (const o of batch.offers ?? []) if (typeof o !== 'string' || !offerShape.test(o) || !digests.has(await offerDigest(o))) problems.push('offer');
    return { ok: problems.length === 0, problems };
  };
  /** §6.1 verifier checks plus §9.2 step 4 for one received certificate and the messages it covers. */
  peer.verifyFromProvider = async (certificate, messages = []) => {
    const problems = [], h = part(certificate, 0), p = part(certificate, 1);
    if (!h || !p) return { ok: false, problems: ['decode'] };
    const keys = await peer.providerCertKeys(p.sub), key = keys.find(k => k.kid === h.kid);
    if (!key) problems.push('cert-kid-not-active-cert-key');
    else if (!await verifyJws(certificate, key.jwk)) problems.push('cert-signature');
    const held = providerKeys.get(p.sub);
    if (held && held.identity !== p.identity) problems.push('cert-identity-claim');
    if (p.iss !== new URL(held?.identity ?? 'https://invalid.example').origin) problems.push('cert-iss');
    if (p.cnf?.jkt !== await thumbprint(p.delegate ?? {})) problems.push('cert-cnf');
    const declared = extensionOptions(await peer.providerManifest(), EXT.signaling)?.max_leg_certificate_seconds;
    if (p.exp - p.iat > (declared ?? 900)) problems.push('cert-lifetime-over-declared');
    for (const m of messages) {
      const mp = part(m, 1), mh = part(m, 0);
      if (mh?.kid !== p.cnf?.jkt || mp?.leg !== p.cnf?.jkt) problems.push('message-leg');
      if (mp?.sid !== p.sid || mp?.aud !== p.aud || mp?.iss !== p.iss || mp?.sub !== p.sub) problems.push('message-binding');
      if (!await verifyJws(m, p.delegate)) problems.push('message-signature');
    }
    return { ok: problems.length === 0, problems, payload: p };
  };
  /** All messages received so far, decoded, optionally for one session. */
  peer.messages = sid => received.flatMap(e => (e.batch?.messages ?? []).map(jws => ({ jws, header: part(jws, 0), payload: part(jws, 1), entry: e }))).filter(m => !sid || m.payload?.sid === sid);
  peer.certificates = sid => received.flatMap(e => (e.batch?.certificates ?? []).map(jws => ({ jws, header: part(jws, 0), payload: part(jws, 1) }))).filter(c => !sid || c.payload?.sid === sid);
  peer.controls = sid => received.flatMap(e => (e.batch?.controls ?? []).map(jws => ({ jws, header: part(jws, 0), payload: part(jws, 1) }))).filter(c => !sid || c.payload?.sid === sid);
  /** Waits until `predicate()` is truthy (polling), or returns its last falsy value after `timeout` ms. */
  peer.until = async (predicate, { timeout = 8000, every = 50 } = {}) => {
    const end = Date.now() + timeout; let value;
    while (!(value = await predicate()) && Date.now() < end) await new Promise(r => setTimeout(r, every));
    return value;
  };
  return peer;
}

/** A session identifier: 22 to 43 base64url characters encoding at least 128 random bits (§7.1). */
export const newSid = () => randomId(16);
/** base64url SHA-256 of an offer token (§5.2 `basis.offer_digest`). */
export const offerDigest = async token => b64(await sha256(token));

/**
 * The simulated network seam: hostnames map to WHATWG handlers. Returns the two ports the Node provider accepts
 * (`DIRECTORY_DNS_LOOKUP`, `DIRECTORY_HTTPS_REQUEST`); the provider's own URL screening, DNS-answer screening, TLS
 * name, redirect and size rules stay in force. `address` is the DNS answer (a public IPv4 by default).
 */
export function nodeNetwork(hosts, { address = '8.8.8.8' } = {}) {
  const log = [];
  const lookup = async (host) => { log.push({ kind: 'lookup', host }); return [{ address, family: 4 }]; };
  const request = (options, callback) => {
    const listeners = new Map(), on = (n, f) => { (listeners.get(n) ?? listeners.set(n, []).get(n)).push(f); return req; };
    const emit = (n, ...a) => { for (const f of listeners.get(n) ?? []) f(...a); };
    const chunks = []; let destroyed = false;
    const req = {
      on, once: on, addListener: on, removeListener() { return req; }, off() { return req; }, setTimeout() { return req; }, setHeader() {}, write(c) { chunks.push(typeof c === 'string' ? utf8(c) : new Uint8Array(c)); return true; },
      destroy() { destroyed = true; return req; },
      end(c) {
        if (c !== undefined) req.write(c);
        queueMicrotask(async () => {
          const host = options.hostname ?? options.host, handler = hosts[host];
          log.push({ kind: 'dial', host, method: options.method, path: options.path, servername: options.servername, port: options.port });
          if (!handler) return emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
          const body = chunks.length ? Buffer.concat(chunks.map(x => Buffer.from(x))) : undefined;
          const headers = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([k]) => !['host', 'content-length'].includes(k.toLowerCase())));
          let response;
          try { response = await handler(new Request(`https://${host}${options.path}`, { method: options.method ?? 'GET', headers, ...body && !['GET', 'HEAD'].includes(options.method ?? 'GET') ? { body } : {} })); }
          catch (error) { return emit('error', error); }
          if (destroyed) return;
          const data = new Uint8Array(await response.arrayBuffer());
          const res = { statusCode: response.status, headers: Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v])), on: null, once: null, destroy() {}, resume() {}, setEncoding() {} };
          const rl = new Map(); res.on = res.once = res.addListener = (n, f) => { (rl.get(n) ?? rl.set(n, []).get(n)).push(f); return res; };
          if (!res.headers['content-length']) res.headers['content-length'] = String(data.length);
          callback(res);
          queueMicrotask(() => { if (data.length) for (const f of rl.get('data') ?? []) f(Buffer.from(data)); for (const f of rl.get('end') ?? []) f(); });
        });
        return req;
      }
    };
    return req;
  };
  return { lookup, request, log };
}
