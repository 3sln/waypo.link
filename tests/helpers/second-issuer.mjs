// A TEST-ONLY second home issuer for foreign-member conformance (organizations design §13.3, R2-M6). It is written
// from docs/spec/organizations.md §3a and §5.2 with raw WebCrypto and its own encoding; it imports no 3sln.me issuer
// code. It is evidence of SELF-CONSISTENCY between this repository's issuer and verifier readings of the spec, not of
// interoperability: the same authors wrote both. Foreign issuers stay behind ORG_FOREIGN_MEMBERS_ENABLED and an empty
// allowlist until a clean-room issuer passes this suite and the outbound-fetch egress gate passes.
//
// It serves, through `fetch` (never the network): the protocol §2 manifest with `directory.v1`, the `?sub=` directory
// lookup and identity documents with signing keys (`use:"sig"`, continuity optional) and certification keys
// (`use:"cert"`), and issues member certificates (`bindle-member-certificate+jwt`) under its active certification key.
const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = text => new TextEncoder().encode(text);
const segment = value => b64(utf8(JSON.stringify(value)));

async function keyPair() { const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']); const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey); return { privateKey: pair.privateKey, jwk: { kty: 'EC', crv: 'P-256', x, y }, kid: crypto.randomUUID() }; }

export async function secondIssuer({ origin = 'https://second.example', clock = () => Date.now(), maxAge = 300 } = {}) {
  const people = new Map(), calls = [];
  const manifest = { version: '0', issuer: origin, authorization_request_endpoint: `${origin}/requests`, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, rpc_endpoint: `${origin}/rpc`, jwks_uri: `${origin}/jwks`, preferences_contract: 'https://contracts.example/preferences', login_presentation: ['redirect'], dpop_signing_alg_values_supported: ['ES256'], features: { 'directory.v1': { directory_url: `${origin}/directory` }, 'key-delegation.v1': { max_certificate_seconds: 600, revocation_bound_seconds: 60 } } };
  const identity = sub => `${origin}/people/${sub}`;
  async function person(sub) {
    if (!people.has(sub)) { const sig = await keyPair(), cert = await keyPair(); people.set(sub, { sub, aep: 0, keys: [{ ...sig, use: 'sig', state: 'active', predecessor: null }, { ...cert, use: 'cert', state: 'active' }] }); }
    return people.get(sub);
  }
  const document = p => ({ v: 1, iss: origin, sub: p.sub, kind: 'person', keys: p.keys.map(k => ({ kid: k.kid, use: k.use, alg: 'ES256', jwk: k.jwk, state: k.state, ...k.use === 'sig' ? { predecessor: k.predecessor ?? null, continuity: null } : {} })) });
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${maxAge}` } });
  async function fetch(url) {
    calls.push(url); const u = new URL(url);
    if (u.origin !== origin) return respond({ error: 'not_found' }, 404);
    if (u.pathname === '/.well-known/bindle/manifest.json') return respond(manifest);
    if (u.pathname === '/directory') { const sub = u.searchParams.get('sub'); return people.has(sub) ? respond({ iss: origin, sub, identity: identity(sub) }) : respond({ error: 'not_found' }, 404); }
    const match = /^\/people\/([0-9a-f-]{36})\/identity\.json$/.exec(u.pathname);
    if (match && people.has(match[1])) return respond(document(people.get(match[1])));
    return respond({ error: 'not_found' }, 404);
  }
  /** A member certificate per spec §5.2, members in the table's order. */
  async function certify({ sub, aud, client, holder, purposes = ['https://spec.bindle.example/purposes/member-access/v1'], lifetime = 600, aep, kid, signWith }) {
    const p = await person(sub), cert = p.keys.find(k => k.use === 'cert' && k.state === 'active'), now = Math.floor(clock() / 1000);
    const header = { alg: 'ES256', kid: kid ?? cert.kid, typ: 'bindle-member-certificate+jwt' };
    const payload = { bindle: 'member-certificate', v: 1, iss: origin, sub, identity: identity(sub), aud, purposes, client, cnf: { jkt: holder.jkt }, delegate: holder.jwk, aep: aep ?? p.aep, jti: b64(crypto.getRandomValues(new Uint8Array(18))), iat: now, exp: now + lifetime };
    const input = `${segment(header)}.${segment(payload)}`;
    return `${input}.${b64(new Uint8Array(await crypto.subtle.sign(ES256, (signWith ?? cert).privateKey, utf8(input))))}`;
  }
  /** Rotates the certification key (the old one retired); returns the new kid. */
  async function rotateCertification(sub) { const p = await person(sub); for (const k of p.keys) if (k.use === 'cert' && k.state === 'active') k.state = 'retired'; const next = await keyPair(); p.keys.push({ ...next, use: 'cert', state: 'active' }); return next.kid; }
  /** A signing-key reset WITHOUT continuity (spec §3a.4: an authority-epoch change at verifiers). */
  async function resetSigning(sub) { const p = await person(sub); for (const k of p.keys) if (k.use === 'sig' && k.state === 'active') k.state = 'revoked'; const next = await keyPair(); p.keys.push({ ...next, use: 'sig', state: 'active', predecessor: null }); }
  return { origin, manifest, fetch, calls, person, certify, rotateCertification, resetSigning, identity };
}
