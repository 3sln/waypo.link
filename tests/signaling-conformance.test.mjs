// Clean-room signaling conformance (signaling.v1 rev 3.2, Appendix C.5 step 6): the RTC-i tests carried by §21.2, with
// its renames and "Changes" table applied.
// Shared world, conventions and seams: tests/helpers/signaling-conformance-world.mjs. Divergences are t.todo in normal
// mode and fail under SIGNALING_CONFORMANCE_STRICT=1 unless marked plausibly intentional.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {APP, CONTRACT, DIRECTORY_EXT, FRAGMENT, FRAGMENT_DOCUMENT, KIND, LINE, METHODS, PEER, PROVIDER, SIGNALING_EXT, VERSIONS_EXT, accept, appMessage, beacon, boot, callee, cancel, checks, contractDocument, declares, decline, deliver, delivered, diverge, endpoint, envelope, ext, invite, openArgs, peerSend, sentinel, sleep, test, useWorld, w} from './helpers/signaling-conformance-world.mjs';
import {keyPair, newSid, now, sdp, fingerprint, offerDigest, part, sign, b64, unb64, malleate, isLowS, candidate, candidateItem, mdns, TYP, MAGIC, MEDIA_TYPE, randomId, verifyJws} from './signaling-conformance-peer.mjs';

useWorld();
// ==== §3.1 / protocol §2: discovery ==================================================================================
test('§3.1 the provider declares the signaling extension: an issuer-origin endpoint, a 120-900 s certificate bound and its profiles', async () => {
  const m = await (await w.wire('/.well-known/bindle/manifest.json')).json(), f = ext(m, SIGNALING_EXT);
  assert.ok(f, 'the signaling extension declared (extensions rev 3.2 `extensions: [{spec, options}]`)');
  assert.deepEqual(Object.keys(f).sort(), ['endpoint', 'max_leg_certificate_seconds', 'profiles']);
  assert.equal(new URL(f.endpoint).origin, PROVIDER);
  assert.ok(Number.isInteger(f.max_leg_certificate_seconds) && f.max_leg_certificate_seconds >= 120 && f.max_leg_certificate_seconds <= 900);
  assert.ok(Array.isArray(f.profiles) && f.profiles.length > 0 && f.profiles.every((p, i) => ['data', 'webrtc'].includes(p) && (i === 0 || f.profiles[i - 1] < p)), 'profiles: a nonempty, unique, ascending subset of the registered profiles: ' + JSON.stringify(f.profiles));
  assert.ok(f.profiles.includes('webrtc'));
  assert.ok(ext(m, DIRECTORY_EXT)?.directory_url?.startsWith(PROVIDER + '/'));
});

test('§3.1 the declaration has its prerequisites and the contract is listed; no intents or intent-links declaration is required of a peer', async () => {
  const m = await (await w.wire('/.well-known/bindle/manifest.json')).json(), missing = [DIRECTORY_EXT, VERSIONS_EXT].filter(spec => !declares(m, spec));
  assert.ok(ext(m, SIGNALING_EXT), 'the signaling extension declared');
  assert.deepEqual(missing, [], 'both prerequisite extensions declared beside it');
  assert.ok((m.contracts ?? []).includes(CONTRACT), 'the signaling contract listed in `contracts`');
  assert.equal(m.features, undefined, 'no `features` member');
  // The peer declares exactly the directory, artefact-versions and signaling extensions (no intents, no intent-links),
  // and the provider still certifies a leg toward it (§3.1 "A peer provider MUST NOT check a peer's intents or
  // intent-links declaration").
  assert.deepEqual(w.peer.manifest.extensions.map(e => e.spec).sort(), [DIRECTORY_EXT, VERSIONS_EXT, SIGNALING_EXT].sort());
  const ctx = await callee(), o = await ctx.c.call('open', openArgs(ctx, ctx.bob, await keyPair()));
  assert.ok(o.result?.certificate, 'open toward a peer without intents declarations: ' + JSON.stringify(o));
});

test('§10.1 / contracts: a contract document carrying x-bindle-brokerable:false is usable (…/contracts/signaling/v1)', async () => {
  // An operator registration of the clean-room document with the marker the spec requires is accepted at boot, does not
  // displace the shipped document (which carries the same marker) while the signaling flags are on, and calls are served.
  const doc = contractDocument({brokerable: true});
  const v = await boot({config: {FEDERATION_SCHEMAS: JSON.stringify({[FRAGMENT]: FRAGMENT_DOCUMENT})}, contracts: envelope(doc)});
  try {
    const acct = await v.account(), c = await v.connect(acct), r = await c.call('register', {kinds: [LINE]});
    assert.equal(r.status, 200, JSON.stringify(r));
  } finally { await v.close(); }
});

test('§10.1 kind approval is checked without a federation-shard call: the default Node wiring answers register instead of hanging', async () => {
  // Former RTC-i divergence 1 (the bound check that deadlocked through the federation shard). Kind approvals are read
  // from the account's own store, so that deadlock class no longer applies; this stays as a no-hang regression for
  // contract writes.
  const acct = await w.account(), c = await w.connect(acct);
  const r = await Promise.race([c.call('register', {kinds: [LINE]}), sleep(4000).then(() => 'timeout')]);
  assert.notEqual(r, 'timeout', 'register answered within 4 s');
  assert.equal(r.status, 200, JSON.stringify(r));
});

// ==== §9.1/§9.2 step 1: shape and bounds -> 400 =====================================================================
/** A fully valid single-invite batch as a raw-object template (aud names a real recipient, so no 404). */
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

test('§9.1 batch envelope: media type, size, JSON, v, members, element counts and offers are refused with 400', async t => {
  const {inv} = await shapeCtx(), b = inv.batch, J = x => JSON.stringify(x), token = b.offers[0];
  await expect400(t, '§9.1, §9.2 step 1', [
    ['Content-Type application/json', J(b), {contentType: 'application/json'}, [400, 415]],
    ['Content-Type text/plain', J(b), {contentType: 'text/plain'}, [400, 415]],
    ['body over 131,072 bytes', J({...b, offers: [token + 'x'.repeat(140000)]}), {}, [400, 413]],
    ['not JSON', '{"v":1,', {}],
    ['JSON array', '[]', {}],
    ['v 2', J({...b, v: 2}), {}],
    ['v "1"', J({...b, v: '1'}), {}],
    ['unknown top-level member', J({...b, extra: true}), {}],
    ['revision 2 `links` member', J({...b, links: []}), {}],
    ['missing messages member', J({v: 1, certificates: b.certificates, controls: [], offers: b.offers}), {}],
    ['certificates, messages and controls all empty', J({v: 1, certificates: [], messages: [], controls: []}), {}],
    ['5 certificates', J({...b, certificates: Array(5).fill(b.certificates[0])}), {}],
    ['33 messages', J({...b, messages: Array(33).fill(b.messages[0])}), {}],
    ['5 controls', J({...b, controls: Array(5).fill(b.certificates[0])}), {}],
    ['5 offers', J({...b, offers: Array(5).fill(token)}), {}],
    ['an offer token of 21 characters', J({...b, offers: [token.slice(0, 21)]}), {}],
    ['an offer token whose digest no invite names', J({...b, offers: [token, randomId(32)]}), {}],
    ['the same offer token twice', J({...b, offers: [token, token]}), {}],
    ['certificates not an array', J({...b, certificates: b.certificates[0]}), {}]
  ]);
});

test('§9.2 step 1 / keys §3: JWS profile violations are refused with 400', async t => {
  const {ctx, inv} = await shapeCtx(), [h, p, s] = inv.message.split('.'), b = inv.batch;
  const withMsg = m => ({...b, messages: [m]}), withCert = c => ({...b, certificates: [c]});
  const raw = async (headerText, payloadText, key = inv.leg) => sign(headerText, payloadText, key);
  const payload = part(inv.message, 1), header = part(inv.message, 0), text = o => JSON.stringify(o);
  const sigBytes = unb64(s), trailing = s.slice(0, -1) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(s.at(-1)) | 1)];
  const msg = o => w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, ...o});
  const cert = o => w.peer.legCertificate({sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, role: 'initiator', kind: inv.kind, leg: inv.leg, ...o});
  await expect400(t, 'keys §3 (via §9.2 step 1)', [
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
    ['nesting deeper than 8', withMsg(await msg({body: {...payload.body, context: {a: {b: {c: {d: {e: {f: {g: {h: 1}}}}}}}}}}))],
    ['header member jku', withMsg(await msg({header: {jku: 'https://peer.example/jwks'}}))],
    ['header member crit', withMsg(await msg({header: {crit: ['x']}}))],
    ['header without typ', withMsg(await msg({header: {typ: undefined}}))],
    ['alg EdDSA', withMsg(await msg({header: {alg: 'EdDSA'}}))],
    ['message typ in the certificates list', withCert(inv.message)],
    ['certificate typ on a control statement', {...b, controls: [inv.cert]}],
    ['certificate with control typ', withCert(await cert({header: {typ: TYP.control}}))],
    ['certificate with member-certificate typ', withCert(await cert({header: {typ: 'bindle-member-certificate+jwt'}}))],
    ['certificate with the rtc-signaling typ', withCert(await cert({header: {typ: 'bindle-rtc-leg-certificate+jwt'}}))]
  ]);
});

test('§6.1/§7.1/§9.2 step 1: exact members, bindle/v, aud form, sid, seq, type and the iat window are refused with 400', async t => {
  const {ctx, inv} = await shapeCtx(), b = inv.batch, payload = part(inv.message, 1);
  const msg = (o = {}) => w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: payload.body, ...o});
  const cert = o => w.peer.legCertificate({sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, role: 'initiator', kind: inv.kind, leg: inv.leg, override: o});
  const M = async o => ({...b, messages: [await msg(o)]}), C = async o => ({...b, certificates: [await cert(o)]});
  const aud = ctx.acct.identity;
  await expect400(t, '§6.1, §7.1, §9.2 step 1', [
    ['message unknown member', await M({override: {group: 'g'}})],
    ['message missing to', await M({override: {to: undefined}})],
    ['message bindle "signaling-msg"', await M({override: {bindle: 'signaling-msg'}})],
    ['message bindle "rtc-message"', await M({override: {bindle: 'rtc-message'}})],
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
    ['invite body missing params', await M({body: {...payload.body, params: undefined}})],
    ['candidates with to null', await M({type: 'candidates', body: {gen: 0, items: [], complete: false}})],
    ['message over 40,960 bytes', await M({body: {...payload.body, params: {offer: sdp({extra: Array.from({length: 1400}, (_, i) => `a=x-pad${i}:${'p'.repeat(20)}`)})}}})],
    ['certificate unknown member', await C({group: 'g'})],
    ['certificate missing aep', await C({aep: undefined})],
    ['certificate missing profile', await C({profile: undefined})],
    ['certificate with the rtc `purpose` member instead of `kind`', await C({kind: undefined, purpose: inv.kind})],
    ['certificate bindle "signaling-cert"', await C({bindle: 'signaling-cert'})],
    ['certificate aud on another origin', await C({aud: aud.replace('provider.example', 'elsewhere.example')})]
  ]);
});

test('§9.1 a batch with one element failing step 1 is refused whole, and its valid elements are not processed', async t => {
  const ctx = await callee(), inv = await invite(ctx), bad = inv.message.replace(/\.[^.]+$/, '.AAAA');
  const r = await w.peer.post({...inv.batch, messages: [inv.message, bad]});
  assert.equal(r.status, 400);
  assert.equal(await delivered(ctx, inv.sid), false, 'the valid invite of a refused batch was not delivered');
  assert.ok(await deliver(ctx, inv), 'the same invite alone is delivered');
});

test('§6.3 high-S signatures are refused on certificates, messages and control statements', async t => {
  const ctx = await callee(); await beacon(ctx);
  const inv = await invite(ctx), highMsg = malleate(inv.message), highCert = malleate(inv.cert);
  assert.ok(isLowS(inv.message) && !isLowS(highMsg) && !isLowS(highCert));
  const statuses = {message: (await w.peer.post({...inv.batch, messages: [highMsg]})).status, certificate: (await w.peer.post({...inv.batch, certificates: [highCert]})).status};
  const b = ctx.beacon, ctrl = await w.peer.control({sub: b.from.sub, aud: ctx.acct.identity, sid: b.sid, leg: b.peerLeg.jkt, reason: 'revoked'});
  statuses.control = (await w.peer.post(w.peer.batch({controls: [malleate(ctrl)]}))).status;
  assert.equal(await delivered(ctx, inv.sid), false, 'no high-S element reached the endpoint');
  assert.equal(ctx.has(e => e.sid === b.sid && e.type === 'state'), false, 'the high-S control did not end the beacon session');
  const not400 = Object.entries(statuses).filter(([, s]) => s !== 400);
  if (not400.length) diverge(t, {section: '§6.3 with §9.2 step 1 ("For each JWS, check ... low-S")', request: 'batches whose message, certificate or control carries the high-S form of a valid signature', observed: not400.map(([k, s]) => `${k} -> ${s}`).join(', '), expected: '400 (step 1)', side: 'implementation'});
  assert.ok(await deliver(ctx, inv), 'the low-S form is delivered');
});

// ==== §9.2 response: uniform 202, uniform 404, two audiences ==========================================================
test('§9.2 AMD-RI1: an aud naming no hosted entity answers the uniform 404', async () => {
  const ctx = await callee(), stranger = `${PROVIDER}/identity/${randomUUID()}`, leg = await keyPair(), sid = newSid();
  const cert = await w.peer.legCertificate({sub: ctx.bob.sub, aud: stranger, sid, role: 'initiator', kind: KIND, leg});
  const m = await w.peer.message({leg, sub: ctx.bob.sub, aud: stranger, sid, seq: 0, type: 'invite', body: {kind: KIND, profile: 'webrtc', answer_by: now() + 60, basis: null, context: null, params: {offer: null}}});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [m]}));
  const unknown = await w.wire(new URL(stranger).pathname + '/identity.json');
  assert.equal(r.status, 404, `${r.status} ${r.body}`);
  assert.equal(unknown.status, 404, 'the same unknown identity URL is 404 on this origin');
});

test('§9.2/§12.1 every step 2-8 outcome answers an identical 202 with an empty body', async () => {
  const ctx = await callee(), cases = {};
  const fresh = await w.peer.entity();
  cases['held key missing'] = (await invite(ctx, {from: fresh})).batch;
  cases['unknown session'] = w.peer.batch({messages: [await w.peer.message({leg: await keyPair(), sub: ctx.bob.sub, aud: ctx.acct.identity, sid: newSid(), to: randomId(32), seq: 1, type: 'end', body: {reason: 'closed'}})]});
  cases['bad signature'] = (await invite(ctx, {msgOpts: {signer: await keyPair()}})).batch;
  cases['unadmitted (no basis)'] = (await invite(ctx, {basis: null})).batch;
  cases['offer token that is no live offer'] = (await invite(ctx, {token: randomId(32)})).batch;
  cases['kind not held'] = (await invite(ctx, {kind: {artefact: 'https://kinds.example/kinds/unknown/v1', version: 1, digest: 'sha256-' + b64(new Uint8Array(32))}})).batch;
  const seen = [];
  for (const [name, batch] of Object.entries(cases)) { const r = await w.peer.post(batch); seen.push({name, status: r.status, body: r.body, type: r.headers.get('content-type'), cache: r.headers.get('cache-control')}); }
  for (const s of seen) assert.deepEqual({status: s.status, body: s.body, type: s.type, cache: s.cache}, {status: 202, body: '', type: seen[0].type, cache: seen[0].cache}, s.name);
});

test('§9.1/§9.2 step 1 AMD-RI2: a batch whose elements name two audiences answers 400', async () => {
  const a = await callee(), b2 = await w.account(), inv = await invite(a);
  const m2 = await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: b2.identity, sid: inv.sid, to: randomId(32), seq: 1, type: 'end', body: {reason: 'closed'}});
  const r = await w.peer.post({...inv.batch, messages: [inv.message, m2]});
  assert.equal(r.status, 400);
  assert.equal(await delivered(a, inv.sid), false, 'nothing of the two-audience batch was processed');
});

// ==== §6.1 certificate rules and §9.2 steps 3-6 (silently dropped, still 202) =========================================
async function dropped(t, ctx, label, inv, section) {
  const r = await w.peer.post(inv.batch);
  if (r.status === 400) { t.diagnostic(`${label}: refused at step 1 (400)`); return; }
  assert.equal(r.status, 202, label);
  if (await delivered(ctx, inv.sid)) diverge(t, {section, request: label, observed: 'invite delivered to the recipient endpoint', expected: 'dropped (not delivered)', side: 'implementation'});
}
test('§6.1 certificate verification: identity-key signatures, unknown kids, mismatched aud/sid/role/kind/profile/identity, lifetime and expiry', async t => {
  const ctx = await callee(); await beacon(ctx); const bob = ctx.bob, e = w.peer.entities.get(bob.sub), other = await w.account();
  const cases = [
    ['certificate signed by the identity signing key (use sig)', await invite(ctx, {certOpts: {signer: e.sig}}), '§6.1 ("A certificate signed by an identity signing key ... fails"); §6.3'],
    ['certificate kid naming no published key', await invite(ctx, {certOpts: {header: {kid: 'no-such-kid'}}}), '§6.1 verifier checks'],
    ['certificate aud naming another recipient', await invite(ctx, {certOverride: {aud: other.identity}}), '§9.2 step 4 (certificate aud matches)'],
    ['certificate sid different from the message sid', await invite(ctx, {certOverride: {sid: newSid()}}), '§9.2 step 4 (certificate sid matches)'],
    ['recipient-role certificate on an invite', await invite(ctx, {certOverride: {role: 'recipient'}}), '§7.2 (only the initiator leg sends invite), §9.2 step 4 role'],
    ['certificate identity claim not the directory URI', await invite(ctx, {certOverride: {identity: `${PEER}/people/${bob.sub}`}}), '§6.1 ("checks that the URI equals identity")'],
    ['invite kind differs from the certificate kind', await invite(ctx, {certOverride: {kind: {...KIND, version: 2}}}), '§9.2 step 4 (kind matches for an invite)'],
    ['invite profile differs from the certificate profile', await invite(ctx, {certOverride: {profile: 'data'}}), '§9.2 step 4 (profile matches for an invite)'],
    ['certificate lifetime 700 s over the declared 600 s', await invite(ctx, {certOpts: {iat: now() - 10, exp: now() + 690}}), '§3.1/§6.1 (no longer than the declared bound)'],
    ['certificate expired 120 s ago', await invite(ctx, {certOpts: {iat: now() - 720, exp: now() - 120}}), '§6.1 (exp with 60 s skew)'],
    ['certificate cnf.jkt not the delegate thumbprint', await invite(ctx, {certOverride: {cnf: {jkt: randomId(32)}}}), '§6.1 cnf/delegate (organizations §5.2)'],
    ['message signed by a key other than the delegate', await invite(ctx, {msgOpts: {signer: await keyPair()}}), '§9.2 step 4 (message signature under delegate)'],
    ['message leg not the certificate cnf.jkt', await invite(ctx, {msgOverride: {leg: randomId(32)}}), '§7.1 ("It MUST equal the certificate\'s cnf.jkt")']
  ];
  for (const [label, inv, section] of cases) await dropped(t, ctx, label, inv, section);
});

test('§9.2 step 6 a certificate with a lower aep than the one recorded is refused', async t => {
  const ctx = await callee(), e = w.peer.entities.get(ctx.bob.sub);
  e.aep = 3; await beacon(ctx); const first = await invite(ctx); assert.ok(await deliver(ctx, first), 'aep 3 accepted');
  e.aep = 2; await dropped(t, ctx, 'invite with aep 2 after aep 3 was recorded', await invite(ctx), '§9.2 step 6 ("Refuse an aep lower than the highest recorded")');
  e.aep = 3;
});

test('§6.1 provider-issued initiator certificates follow the profile and verify against its active certification keys', async () => {
  const ctx = await callee(), appLeg = await keyPair();
  const o = await ctx.c.call('open', openArgs(ctx, ctx.bob, appLeg));
  assert.ok(o.result?.certificate, JSON.stringify(o));
  const cert = o.result.certificate, h = part(cert, 0), p = part(cert, 1), m = await w.peer.providerManifest();
  assert.deepEqual(Object.keys(h).sort(), ['alg', 'kid', 'typ']); assert.equal(h.alg, 'ES256'); assert.equal(h.typ, TYP.cert);
  assert.deepEqual(Object.keys(p).sort(), ['aep', 'aud', 'bindle', 'client', 'cnf', 'delegate', 'exp', 'iat', 'identity', 'iss', 'jti', 'kind', 'profile', 'role', 'sid', 'sub', 'v'].sort());
  assert.equal(p.bindle, MAGIC.cert); assert.equal(p.v, 1); assert.equal(p.role, 'initiator'); assert.equal(p.iss, PROVIDER); assert.equal(p.sub, ctx.acct.sub);
  assert.equal(p.identity, ctx.acct.identity, 'identity equals the directory-derived URI'); assert.equal(p.aud, ctx.bob.identity);
  assert.match(p.sid, /^[A-Za-z0-9_-]{22,43}$/); assert.ok(unb64(p.sid).length >= 16, 'sid carries at least 128 bits');
  assert.equal(o.result.sid, p.sid);
  assert.equal(p.cnf.jkt, appLeg.jkt); assert.deepEqual(p.delegate, appLeg.jwk);
  assert.deepEqual(p.client, {client_id: APP.id, origin: APP.origin, feature: null});
  assert.deepEqual(p.kind, KIND, 'the kind version the app was approved for'); assert.equal(p.profile, 'webrtc');
  assert.ok(Number.isSafeInteger(p.aep) && p.aep >= 0);
  assert.ok(p.exp - p.iat <= ext(m, SIGNALING_EXT).max_leg_certificate_seconds);
  assert.ok(isLowS(cert), 'low-S');
  const v = await w.peer.verifyFromProvider(cert); assert.deepEqual(v.problems, []);
  const doc = w.peer.providerDocument(ctx.acct.sub);
  assert.ok(doc.keys.some(k => k.kid === h.kid && k.use === 'cert' && k.state === 'active'), 'signed by an active use:"cert" key');
  assert.ok(!doc.keys.some(k => k.kid === h.kid && k.use === 'sig'), 'never the identity signing key');
});

test('§6.1 the provider refuses a delegate already certified in a live session', async t => {
  const ctx = await callee(), leg = await keyPair();
  const a = await ctx.c.call('open', openArgs(ctx, ctx.bob, leg));
  const b = await ctx.c.call('open', openArgs(ctx, ctx.bob, leg));
  assert.ok(a.result?.certificate, JSON.stringify(a));
  if (b.result?.certificate) diverge(t, {section: '§6.1 issuance ("refuses a delegate already certified in any live session of the entity, or within the last 24 h")', request: 'open twice with the same delegate', observed: 'second certificate issued', expected: 'refused', side: 'implementation'});
  else { assert.ok(b.error, JSON.stringify(b)); t.diagnostic(`second open with the same delegate -> ${JSON.stringify(b.error)}`); }
});

// ==== §5.2 / §5.7 admission ==========================================================================================
test('§5.3/§7.2/§9.1 an invite carrying link_digest or callback_digest, and a batch carrying links, are invalid (400)', async t => {
  const ctx = await callee(), inv = await invite(ctx), digest = part(inv.message, 1).body.basis.offer_digest;
  const withBody = async body => ({...inv.batch, messages: [await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 0, type: 'invite', body: {...part(inv.message, 1).body, ...body}})]});
  await expect400(t, '§5.3, §7.2 (unknown members), §9.1 ("Unknown members are invalid, including revision 2\'s links")', [
    ['basis {link_digest}', JSON.stringify({...await withBody({basis: {link_digest: digest}}), offers: []}), {}],
    ['basis {offer_digest, link_digest}', JSON.stringify(await withBody({basis: {offer_digest: digest, link_digest: digest}})), {}],
    ['invite body with callback_digest: null', JSON.stringify(await withBody({callback_digest: null})), {}],
    ['invite body with a callback_digest', JSON.stringify(await withBody({callback_digest: digest})), {}],
    ['batch with links []', JSON.stringify({...inv.batch, links: []}), {}],
    ['batch with links beside the offer', JSON.stringify({...inv.batch, links: ['https://provider.example/link']}), {}]
  ]);
  assert.equal(await delivered(ctx, inv.sid), false, 'none of them admitted the invite');
  assert.ok(await deliver(ctx, inv), 'the valid offer-basis invite is delivered');
});

test('§5.7/§5.4 case 3 an inbound offer-basis invite is admitted within its uses and routed only to the minting endpoint', async t => {
  const ctx = await callee(), minter = await ctx.register(); await beacon(ctx);
  const {offers} = await ctx.mint({uses: 2}, minter.ep), token = offers[0].offer;
  assert.equal(offers[0].principal, null, 'an open offer');
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    const inv = await invite(ctx, {token}), e = await deliver(minter, inv);
    assert.ok(e, `dial-back ${i + 1} admitted and delivered to the minting endpoint`);
    assert.equal(e.projection.basis, 'offer'); assert.equal(e.projection.offer_match, true, 'offer_match on the minting endpoint');
    assert.equal(JSON.stringify(e).includes(token), false, 'the offer token is never in a listen event');
    sessions.push(await accept(ctx, inv, minter));
  }
  assert.equal(ctx.has(e => e.type === 'invite' && sessions.some(s => s.sid === e.sid)), false, 'never routed to the other endpoint of the same app');
  // Both uses are spent by the accepts; a third dial-back admits nothing (uniform 202).
  const third = await invite(ctx, {token}); assert.equal((await w.peer.post(third.batch)).status, 202);
  if (await delivered(ctx, third.sid, {l: minter})) diverge(t, {section: '§5.2 ("spent plus reserved uses never exceed uses")', request: 'a third dial-back on a uses:2 open offer whose two sessions were accepted', observed: 'delivered', expected: 'admits nothing', side: 'implementation'});
});

test('§5.2/§5.7 a bound offer presented by the wrong principal admits nothing and reserves nothing; its principal can still use it', async t => {
  const ctx = await callee(); await beacon(ctx); const mallory = await w.peer.entity();
  const warm = await invite(ctx, {from: mallory}); assert.ok(await deliver(ctx, warm), 'second peer principal warmed');
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: warm.leg, sub: mallory.sub, aud: ctx.acct.identity, sid: warm.sid, seq: 1, type: 'cancel', body: {}})]}));
  const minted = await ctx.mint({principals: [ctx.bob.principal]}), token = minted.offers[0].offer;
  // §5.7/§10.2: `offer` returns {offers: [{principal, offer}]} with the bound principal. Observed: the shipped contract
  // document (docs/artefacts/signaling-v1.json, $defs/result_offer/.../principal) declares `principal` as a bare
  // object, so the dispatcher's pinned result projection (packages/federation/integrations.mjs shapeContractResult)
  // withholds its members and the app receives `{}`.
  if (JSON.stringify(minted.offers[0].principal) !== JSON.stringify(ctx.bob.principal)) diverge(t, {section: '§5.7 ("It returns {offers: [{principal, offer}], expires_at}"), §10.2 offer', request: 'offer with principals [bob]', observed: `principal ${JSON.stringify(minted.offers[0].principal)}`, expected: `principal ${JSON.stringify(ctx.bob.principal)}`, side: 'implementation (docs/artefacts/signaling-v1.json result_offer principal has no properties; shapeContractResult strips undeclared members)'});
  const offerState = async () => (await (await w.request('/api/signaling/settings', ctx.acct.owner)).json()).apps.flatMap(a => a.offers).find(o => o.principal?.sub === ctx.bob.sub);
  await dropped(t, ctx, 'invite from another principal over an offer bound to bob', await invite(ctx, {from: mallory, token}), '§5.2 (bound offer: "its principal equals the verified origin principal")');
  const before = await offerState();
  t.diagnostic(`bound offer after the wrong principal: ${JSON.stringify(before && {spent: before.spent, reserved: before.reserved})}`);
  if (before) assert.deepEqual({spent: before.spent, reserved: before.reserved}, {spent: 0, reserved: 0}, 'nothing reserved or spent');
  const good = await invite(ctx, {token}); assert.equal((await w.peer.post(good.batch)).status, 202);
  assert.ok(await delivered(ctx, good.sid), 'the bound principal is admitted');
});

// ==== §16.4 SDP and candidates =======================================================================================
test('§16.4 invite offers that break the SDP rules are not delivered (and conforming variants are)', async t => {
  const ctx = await callee(); await beacon(ctx);
  const good = [['one fingerprint repeated at session and media level', sdp({mediaFp: fingerprint()})], ['audio and video m-lines', sdp({kinds: ['audio', 'video']})]];
  for (const [label, offer] of good) { const inv = await invite(ctx, {offer}); assert.equal((await w.peer.post(inv.batch)).status, 202); assert.ok(await delivered(ctx, inv.sid), label); await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 1, type: 'cancel', body: {}})]})); }
  const bad = [
    ['a=candidate line', sdp({mediaExtra: ['a=candidate:1 1 udp 2122260223 10.0.0.2 5000 typ host']})],
    ['A=CANDIDATE line (case-insensitive)', sdp({mediaExtra: ['a=CANDIDATE:1 1 udp 2122260223 10.0.0.2 5000 typ host']})],
    ['a=end-of-candidates', sdp({mediaExtra: ['a=end-of-candidates']})],
    ['a=remote-candidates', sdp({mediaExtra: ['a=remote-candidates:1 10.0.0.2 5000']})],
    ['no a=ice-options:trickle', sdp({trickle: false})],
    ['c= with a real address', sdp({connection: 'c=IN IP4 192.0.2.10'})],
    ['a=rtcp with a real address', sdp({kinds: ['audio'], mediaExtra: ['a=rtcp:9 IN IP4 192.0.2.10']})],
    ['o= with a public address', sdp({origin: 'o=- 4611731400430051336 2 IN IP4 192.0.2.10'})],
    ['o= username not - or digits (Firefox style)', sdp({origin: 'o=mozilla...THIS_IS_SDPARTA-99.0 4611731400430051336 0 IN IP4 0.0.0.0'})],
    ['u= line', sdp({extra: ['u=https://example.com/']})],
    ['e= line', sdp({extra: ['e=someone@example.com']})],
    ['two different fingerprints (session and media)', sdp({mediaFp: fingerprint(0x11)})],
    ['only a sha-1 fingerprint', sdp({omitFingerprint: true, extra: ['a=fingerprint:sha-1 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01']})],
    ['no fingerprint', sdp({omitFingerprint: true})],
    ['m=text (not audio, video or application)', sdp({kinds: ['text']})],
    ['LF line endings', sdp({eol: '\n'})],
    ['a dotted quad outside address fields', sdp({mediaExtra: ['a=x-note:host 198.51.100.7']})],
    ['an IPv6-like run outside address fields', sdp({mediaExtra: ['a=x-note:fe80::1:2']})],
    ['an IN IP4 token outside o=/c=/a=rtcp', sdp({mediaExtra: ['a=x-note:IN IP4']})],
    ['SDP over 24,576 bytes (one long line, so the message stays under 40,960 bytes)', sdp({mediaExtra: ['a=x-pad:' + 'q'.repeat(24600)]})]
  ];
  const leaked = [];
  for (const [label, offer] of bad) { const inv = await invite(ctx, {offer}); const r = await w.peer.post(inv.batch); inv.label = label; inv.status = r.status; leaked.push(inv); }
  await sentinel(ctx);
  const through = leaked.filter(inv => ctx.has(e => e.type === 'invite' && e.sid === inv.sid)).map(inv => inv.label);
  t.diagnostic('statuses: ' + leaked.map(i => `${i.label}=${i.status}`).join('; '));
  if (through.length) diverge(t, {section: '§16.4', request: 'invites whose params.offer breaks one SDP rule each', observed: `delivered: ${through.join('; ')}`, expected: 'none delivered', side: 'implementation'});
});

test('§16.4/§7.2 no SDP and no candidates travel before the claim', async t => {
  const ctx = await callee(); await beacon(ctx);
  const inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  const mk = (seq, type, body) => w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, to: randomId(32), seq, type, body});
  const c1 = await mk(1, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}), s2 = await mk(2, 'sdp', {gen: 1, description: {type: 'offer', sdp: sdp()}});
  for (const m of [c1, s2]) await w.peer.post(w.peer.batch({messages: [m]}));
  await sentinel(ctx);
  const leaked = ctx.events.filter(e => e.type === 'message' && [c1, s2].includes(e.message));
  if (leaked.length) diverge(t, {section: '§16.4 ("No SDP and no candidate travels before the claim"), §7.2', request: 'candidates and sdp messages from the initiator leg while the invite is unclaimed', observed: `${leaked.length} delivered`, expected: 'none delivered', side: 'implementation'});
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, seq: 3, type: 'cancel', body: {}})]}));
});

test('§16.4 candidate rules after the claim in a cross-entity session (each refused message consumes its seq, §9.2 step 5)', async t => {
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
      // n+1 is held, so the receiver did not record n. Refill n with a conforming message (by the letter of §7.3 a
      // reuse of n with different content, which must end the leg if n had been recorded).
      const fill = await peerSend(ctx, s, 'candidates', item(candidate()), {seq: bad.seq, timeout: 2500});
      const then = await ctx.waitEvent(e => e.message === next.m, 2500);
      gaps.push(`${label} [n+1 held; refill of n ${fill.got ? 'delivered' : 'not delivered'}; n+1 ${then ? 'then delivered' : 'still held'}]`);
      if (!fill.got && !then) { wrong.push(`session stalled after "${label}"`); break; }
    }
  }
  if (wrong.length) diverge(t, {section: '§16.4', request: 'candidates messages after the claim, one rule broken each, each followed by a conforming one', observed: wrong.join('; '), expected: 'conforming delivered; non-conforming not delivered', side: 'implementation'});
  if (gaps.length) diverge(t, {section: '§9.2 step 5 ("A (sid, leg, seq) is recorded only after step 4") and step 7', request: 'a non-conforming candidates message at seq n (refused at step 7), then a conforming one at n+1', observed: `n+1 was not delivered after: ${gaps.join('; ')}`, expected: 'n is recorded at step 5, so n+1 is in order and delivered', side: 'implementation'});
  await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [await appMessage(ctx, s, {seq: s.appSeq++, type: 'end', body: {reason: 'closed'}})]});
});

test('§16.4/§16.5 the provider enforces the rules and the relay-only default on its own endpoint\'s send', async t => {
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
  if (wrong.length) diverge(t, {section: '§16.4, §10.2 send, §16.5 (default relay for another entity)', request: 'send of non-conforming or policy-violating messages', observed: wrong.join('; '), expected: 'refused with invalid_args and never relayed', side: 'implementation'});
});

// ==== §7.3 ordering and replay =======================================================================================
test('§7.3 duplicates are ignored, a gap is buffered and filled in order, and a message for an ended session is ignored', async t => {
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
  const end = await peerSend(ctx, s, 'end', {reason: 'closed'}); assert.ok(end.got);
  assert.ok(await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended'), 'ended');
  const after = await peerSend(ctx, s, 'candidates', item, {timeout: 1500});
  assert.equal(after.got, false, 'nothing is delivered for an ended session');
});

test('§7.3 reusing a seq with different content ends the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const a = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}); assert.ok(a.got);
  const b = await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: a.seq, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.9'}))], complete: true}});
  assert.equal((await w.peer.post(w.peer.batch({messages: [b]}))).status, 202);
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state', 4000);
  const control = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.reason === 'failed'), {timeout: 3000});
  t.diagnostic(`endpoint state: ${JSON.stringify(ended && {state: ended.state})}; control to the peer: ${control ? JSON.stringify({leg: control.payload.leg, reason: control.payload.reason}) : 'none'}`);
  if (!ended) diverge(t, {section: '§7.3 ("Reusing a seq with different content ends the leg with failed")', request: 'a second, different message with an already accepted (sid, leg, seq)', observed: 'session not ended at the receiver', expected: 'the leg ended (failed)', side: 'implementation'});
  if (ended && control) assert.ok(control.payload.leg === s.peerLeg.jkt || control.payload.leg === null);
});

test('§7.3 a gap that is not filled within 10 s ends the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {seq: s.peerSeq + 1, wait: false});
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 16000);
  if (!ended) diverge(t, {section: '§7.3 ("buffers at most 32 messages ahead of a gap, for at most 10 s, and then ends the leg with failed")', request: 'one message at seq n+1 with seq n never sent', observed: 'not ended within 16 s', expected: 'leg ended (failed) after about 10 s', side: 'implementation'});
});

test('§7.2/§9.2 step 2 a replayed invite is not delivered again, and an invite at seq 1 is refused', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  await w.peer.post(inv.batch); await w.peer.post(inv.batch);
  const leg = await keyPair(), sid = newSid(), cert = await w.peer.legCertificate({sub: ctx.bob.sub, aud: ctx.acct.identity, sid, role: 'initiator', kind: KIND, leg});
  const seq1 = await w.peer.message({leg, sub: ctx.bob.sub, aud: ctx.acct.identity, sid, seq: 1, type: 'invite', body: part(inv.message, 1).body});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [seq1], offers: inv.batch.offers}));
  await delivered(ctx, sid);
  assert.equal(ctx.events.filter(e => e.type === 'invite' && e.sid === inv.sid).length, 1, 'the invite was delivered once');
  if (ctx.has(e => e.type === 'invite' && e.sid === sid)) diverge(t, {section: '§7.2 ("invite is the initiator\'s seq 0")', request: 'an invite at seq 1', observed: `delivered (post ${r.status})`, expected: 'refused', side: 'implementation'});
});

// ==== flows: provider as recipient ===================================================================================
test('flow (peer opens to provider): invite, claim, accept, candidates both ways relayed unchanged, peer end', async t => {
  const ctx = await callee(), inv = await invite(ctx), e = await deliver(ctx, inv);
  assert.ok(e, 'invite delivered'); assert.equal(e.invite, inv.message, 'raw invite delivered unchanged'); assert.equal(e.certificate, inv.cert);
  assert.deepEqual(e.projection.initiator, ctx.bob.principal); assert.equal(e.projection.basis, 'offer');
  assert.deepEqual(e.projection.kind, KIND); assert.equal(e.projection.profile, 'webrtc');
  assert.equal(JSON.stringify(e).includes(inv.token), false, 'the offer token is never delivered to endpoints');
  // §10.3: `params` is "the projected profile parameters" (webrtc: {offer}). Observed `{}`: the shipped contract
  // document declares $defs/event/properties/projection/properties/params (and `context`) as bare objects, so the
  // dispatcher's pinned result projection (shapeContractResult) withholds their members.
  if (JSON.stringify(e.projection.params) !== JSON.stringify(part(inv.message, 1).body.params)) diverge(t, {section: '§10.3 (projection `params`: "the projected profile parameters")', request: 'listen after a webrtc invite whose params.offer is an SDP string', observed: `projection.params ${JSON.stringify(e.projection.params)?.slice(0, 60)}`, expected: 'projection.params {offer: <the SDP>}', side: 'implementation (docs/artefacts/signaling-v1.json event projection params/context have no properties; shapeContractResult strips undeclared members)'});
  const s = await accept(ctx, inv);
  const got = w.peer.messages(s.sid).find(m => m.payload.type === 'accept'), entry = got.entry;
  assert.equal(got.jws, s.accept, 'the accept is relayed unchanged'); assert.deepEqual(entry.step1.problems, []);
  assert.equal(entry.contentType, MEDIA_TYPE); assert.ok(entry.bytes <= 131072);
  const cert = entry.batch.certificates.find(c => part(c, 1).role === 'recipient'); assert.ok(cert, 'the recipient certificate accompanies its first message');
  const v = await w.peer.verifyFromProvider(cert, [s.accept]); assert.deepEqual(v.problems, []);
  assert.equal(v.payload.aud, ctx.bob.identity); assert.equal(v.payload.sid, s.sid); assert.equal(part(s.accept, 1).to, inv.leg.jkt);
  assert.deepEqual(v.payload.kind, KIND); assert.equal(v.payload.profile, 'webrtc');
  const pc = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: true}); assert.ok(pc.got);
  const ac = await appMessage(ctx, s, {seq: s.appSeq++, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.1'}))], complete: true}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [ac]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === ac)), 'candidates relayed unchanged');
  assert.ok((await peerSend(ctx, s, 'end', {reason: 'closed'})).got);
  assert.ok(await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state' && x.state === 'ended'), 'state ended');
});

test('flow (peer opens to provider): the provider\'s endpoint ends with end (closed)', async () => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const end = await appMessage(ctx, s, {seq: s.appSeq++, type: 'end', body: {reason: 'closed'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === end)), 'end relayed');
});

test('flow (peer opens to provider): a decline claimed by the endpoint reaches the initiator with the recipient certificate', async () => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv));
  const appLeg = await keyPair(), cl = await ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'decline', delegate: appLeg.jwk});
  assert.ok(cl.result?.certificate, JSON.stringify(cl));
  const s = {...inv, appLeg, peerLeg: inv.leg, peerIdentity: inv.from.identity};
  const dec = await appMessage(ctx, s, {seq: 0, type: 'decline', body: {reason: 'declined'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: inv.sid, messages: [dec]})).result?.accepted, 1);
  const got = await w.peer.until(() => w.peer.messages(inv.sid).find(m => m.jws === dec));
  assert.ok(got, 'decline relayed'); assert.ok(got.entry.batch.certificates.some(c => part(c, 1).role === 'recipient'));
});

test('flow (peer opens to provider): cancel before the claim ends the invite; cancel after the claim is processed as end', async t => {
  const ctx = await callee();
  const a = await invite(ctx); assert.ok(await deliver(ctx, a));
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: a.leg, sub: a.from.sub, aud: ctx.acct.identity, sid: a.sid, seq: 1, type: 'cancel', body: {}})]}));
  assert.ok(await ctx.waitEvent(e => e.sid === a.sid && (e.type === 'state' || e.type === 'message' && part(e.message, 1)?.type === 'cancel')), 'cancel reached the endpoint');
  const late = await ctx.c.call('claim', {...ctx.ep, sid: a.sid, outcome: 'accept', delegate: (await keyPair()).jwk});
  assert.ok(!late.result?.certificate, 'a cancelled session cannot be claimed: ' + JSON.stringify(late));
  const b = await invite(ctx); assert.ok(await deliver(ctx, b)); const s = await accept(ctx, b);
  await w.peer.post(w.peer.batch({messages: [await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: null, seq: s.peerSeq++, type: 'cancel', body: {}})]}));
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 5000);
  if (!ended) diverge(t, {section: '§8.4 ("A cancel that reaches the recipient provider after a successful claim is processed as end with closed")', request: 'cancel (to null) from the initiator leg after the claim', observed: 'session not ended at the recipient endpoint', expected: 'ended', side: 'implementation'});
});

test('§5.5/§8.5/§12.1 an owner end, an unanswered invite, an approval removal and an app revocation send the initiator nothing', async t => {
  const ctx = await callee();
  // An owner end of a pending invite through the provider's interface (§5.5 "Decline", §8.5).
  const a = await invite(ctx); assert.ok(await deliver(ctx, a));
  const r = await w.post('/api/signaling/end-session', {sid: a.sid, initiator: ctx.bob.principal}, ctx.acct.owner);
  t.diagnostic(`owner end-session -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  assert.ok(await ctx.waitEvent(e => e.sid === a.sid && e.type === 'state' && e.state === 'ended', 4000), 'the owner\'s own endpoint is told ended');
  // An invite left unanswered past answer_by.
  const b = await invite(ctx, {answerIn: 3}); assert.ok(await deliver(ctx, b));
  await sleep(5500);
  // The app's session handler approval removed while an invite is pending (§14.2, §8.5).
  const c2 = await invite(ctx); assert.ok(await deliver(ctx, c2));
  const un = await w.post('/api/intents/session-unapprove', {clientId: APP.id, kind: LINE}, ctx.acct.owner);
  t.diagnostic(`owner session-unapprove -> ${un.status} ${(await un.text()).slice(0, 200)}`);
  // The app's grant revoked while an invite is pending (re-approved, on a fresh endpoint).
  const [re] = await w.widen(ctx.acct, [{action: 'session-approve', input: {clientId: APP.id, kind: KIND}}]); assert.equal(re.status, 200, 're-approval');
  const second = await ctx.register(); ctx.current = null;
  const {offers} = await ctx.mint({uses: 4}, second.ep), d = await invite(ctx, {token: offers[0].offer}); assert.ok(await deliver(second, d), 'delivered to the new endpoint');
  const grants = await (await w.request('/api/grants', ctx.acct.owner)).json(), list = grants.grants ?? grants;
  for (const g of Array.isArray(list) ? list : []) if (g.clientId === APP.id || g.client?.id === APP.id) await w.request('/api/grants/' + g.id, {...ctx.acct.owner, method: 'DELETE'});
  await sleep(2500);
  const sent = [a, b, c2, d].flatMap(x => [...w.peer.messages(x.sid), ...w.peer.controls(x.sid)]);
  if (sent.length) diverge(t, {section: '§8.5 ("A recipient session that no endpoint has claimed ends silently"), §12.1', request: 'owner end; unanswered past answer_by; approval removed while pending; app grant revoked while pending', observed: sent.map(m => `${m.payload.type ?? m.payload.bindle}/${m.payload.reason ?? ''}`).join(', '), expected: 'nothing sent to the initiator provider', side: 'implementation'});
});

// ==== flows: provider as initiator ===================================================================================
async function openCall(ctx, {to = ctx.bob, token = w.peer.mintOffer()} = {}) {
  const appLeg = await keyPair(), offer = sdp(), o = await ctx.c.call('open', openArgs(ctx, to, appLeg, {token, params: {offer}}));
  assert.ok(o.result?.certificate, 'open: ' + JSON.stringify(o));
  const s = {sid: o.result.sid ?? part(o.result.certificate, 1).sid, cert: o.result.certificate, appLeg, to, token, peerIdentity: to.identity, appSeq: 0};
  s.invite = await appMessage(ctx, s, {seq: s.appSeq++, type: 'invite', to: null, body: {kind: part(s.cert, 1).kind, profile: 'webrtc', answer_by: now() + 100, basis: {offer_digest: await offerDigest(token)}, context: null, params: {offer}}});
  const sent = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [s.invite]}); assert.equal(sent.result?.accepted, 1, 'send invite: ' + JSON.stringify(sent));
  s.received = await w.peer.until(() => w.peer.messages(s.sid).find(m => m.jws === s.invite), {timeout: 6000});
  return s;
}
async function peerAnswer(ctx, s, type = 'accept', {leg, body} = {}) {
  leg ??= await keyPair();
  const cert = await w.peer.legCertificate({sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, role: 'recipient', kind: part(s.cert, 1).kind, profile: 'webrtc', leg});
  const m = await w.peer.message({leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: 0, type, body: body ?? (type === 'accept' ? {params: {answer: sdp({setup: 'active'})}} : {reason: 'declined'})});
  const r = await w.peer.post(w.peer.batch({certificates: [cert], messages: [m]}));
  return {leg, cert, m, r};
}

test('flow (provider opens to peer on its offer): open, invite delivered with its certificate and the offer token, accept, candidates, end', async () => {
  // The peer mints a bound offer for the provider entity's principal (§5.7) and checks the dial-back at admission (§5.2).
  const ctx = await callee(), token = w.peer.mintOffer({sub: ctx.bob.sub, principal: ctx.acct.principal, kind: LINE, profile: 'webrtc'}), s = await openCall(ctx, {token});
  assert.ok(s.received, 'the invite reached the peer endpoint');
  const e = s.received.entry; assert.deepEqual(e.step1.problems, []); assert.equal(e.contentType, MEDIA_TYPE);
  const admission = await w.peer.admitOffer(e, part(s.invite, 1), part(s.cert, 1));
  assert.deepEqual(admission, {admitted: true, reason: null}, 'the dial-back passes §5.2 "Verifying an offer basis" at the minting peer');
  assert.equal((await w.peer.admitOffer(e, part(s.invite, 1), part(s.cert, 1))).admitted, false, 'a bound offer admits once');
  assert.ok(e.batch.certificates.includes(s.cert), 'the initiator certificate accompanies the first message');
  assert.deepEqual(part(s.invite, 1).body.basis, {offer_digest: await offerDigest(s.token)});
  assert.deepEqual(e.batch.offers, [s.token], 'the offer token travels beside the invite (§5.7 "Dialing back", §9.1), and nothing else');
  const v = await w.peer.verifyFromProvider(s.cert, [s.invite]); assert.deepEqual(v.problems, []);
  assert.ok(w.net.log.filter(x => x.kind === 'dial' && x.method === 'POST').every(x => x.host === 'peer.example' && x.path === '/bindle/signaling'), 'POSTs only to the declared endpoint');
  const ans = await peerAnswer(ctx, s); assert.equal(ans.r.status, 202);
  assert.ok(await ctx.waitEvent(x => x.sid === s.sid && x.type === 'message' && x.message === ans.m), 'accept delivered to the initiator endpoint');
  const pc = await w.peer.message({leg: ans.leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: 1, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate())], complete: true}});
  await w.peer.post(w.peer.batch({messages: [pc]}));
  assert.ok(await ctx.waitEvent(x => x.message === pc), 'peer candidates delivered');
  const ac = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'candidates', body: {gen: 0, items: [candidateItem(candidate({address: '35.190.0.1'}))], complete: true}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [ac]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === ac)), 'app candidates relayed unchanged');
  const later = w.peer.received.filter(x => x.batch?.messages?.includes(ac));
  assert.ok(later.every(x => !x.batch.offers), 'later batches carry no offers');
  const end = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'end', body: {reason: 'closed'}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === end)), 'end relayed');
});

test('flow (provider opens to peer): a decline reaches the initiator endpoint and ends the session', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const ans = await peerAnswer(ctx, s, 'decline'); assert.equal(ans.r.status, 202);
  assert.ok(await ctx.waitEvent(x => x.message === ans.m), 'decline delivered');
  // §8.1: decline ends the session at the initiator provider. The spec does not say that the initiator endpoint also
  // gets a `state` event (the decline message is the signal), so the observable checked is that nothing more is relayed.
  const state = await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state', 1500);
  t.diagnostic(`initiator endpoint state event after decline: ${state ? state.state : 'none'}`);
  const end = await appMessage(ctx, {...s, peerLeg: ans.leg}, {seq: s.appSeq++, type: 'end', body: {reason: 'closed'}});
  const r = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [end]});
  await sleep(500);
  assert.equal(w.peer.messages(s.sid).some(m => m.jws === end), false, 'nothing is relayed after the decline ended the session: ' + JSON.stringify(r));
});

test('flow (provider opens to peer): cancel reaches the peer; a later accept is answered with a control end (failed)', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const cancel = await appMessage(ctx, s, {seq: s.appSeq++, type: 'cancel', to: null, body: {}});
  assert.equal((await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [cancel]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(s.sid).some(m => m.jws === cancel)), 'cancel relayed');
  const ans = await peerAnswer(ctx, s); assert.equal(ans.r.status, 202);
  const ctl = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.leg === ans.leg.jkt), {timeout: 5000});
  if (!ctl) diverge(t, {section: '§8.4 ("An accept that reaches the initiator provider after the initiator\'s cancel is answered with a control statement end (failed) for that recipient leg")', request: 'recipient accept after the initiator cancelled', observed: 'no control statement received', expected: 'control end, reason failed, leg = the recipient leg jkt', side: 'implementation'});
  else { assert.equal(ctl.payload.reason, 'failed'); assert.equal(ctl.header.typ, TYP.control); assert.equal(ctl.payload.bindle, MAGIC.control); assert.ok(isLowS(ctl.jws)); const keys = await w.peer.providerCertKeys(ctx.acct.sub); assert.ok(await verifyJws(ctl.jws, keys.find(k => k.kid === ctl.header.kid)?.jwk ?? {}), 'control verifies under an active cert key'); }
});

test('§8.2 the initiator provider accepts only the first answer; a later recipient leg gets a control end (failed)', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const first = await peerAnswer(ctx, s); assert.ok(await ctx.waitEvent(x => x.message === first.m));
  const second = await peerAnswer(ctx, s); assert.equal(second.r.status, 202);
  await sleep(300); await ctx.poll();
  assert.equal(ctx.has(x => x.message === second.m), false, 'the second answer never reaches the initiator endpoint');
  const ctl = await w.peer.until(() => w.peer.controls(s.sid).find(c => c.payload.leg === second.leg.jkt), {timeout: 5000});
  if (!ctl) diverge(t, {section: '§8.2 ("Any later recipient leg is sent a control statement end with failed")', request: 'a second accept from a different recipient leg', observed: 'no control statement received', expected: 'control end failed for the second leg', side: 'implementation'});
});

test('§9.3 delivery retries 5xx with the JWS values unchanged', async () => {
  const ctx = await callee(); let failures = 1;
  w.peer.endpointStatus = () => failures-- > 0 ? 503 : 202;
  try {
    const s = await openCall(ctx); assert.ok(s.received);
    const posts = await w.peer.until(() => { const p = w.peer.received.filter(e => e.batch?.messages?.includes(s.invite)); return p.length >= 2 && p; }, {timeout: 10000});
    assert.ok(posts, 'retried after 503'); assert.equal(posts[0].status, 503);
    assert.deepEqual(posts[1].batch.messages, posts[0].batch.messages, 'retried JWS values unchanged');
    assert.deepEqual(posts[1].batch.offers, posts[0].batch.offers, 'retried offers unchanged');
  } finally { w.peer.endpointStatus = 202; }
});

test('§5.1 open to an issuer that declares no signaling extension fails with unsupported_peer', async t => {
  const ctx = await callee(), plain = await w.peers.plain.entity();
  const o = await ctx.c.call('open', openArgs(ctx, plain, await keyPair()));
  t.diagnostic(`requests the provider made to the peer without the signaling extension: ${w.peers.plain.requests.map(r => r.method + ' ' + new URL(r.url).pathname).join(', ') || 'none'}`);
  assert.equal(o.error?.code, 'unsupported_peer', JSON.stringify(o.error ?? o.result));
  assert.ok(!w.peers.plain.requests.some(r => new URL(r.url).pathname.includes('/identity/')), 'no identity document fetched from an issuer without the signaling extension');
});

test('protocol §2 floor: a peer whose manifest omits the optional DPoP declaration can still be opened to', async t => {
  const ctx = await callee(), f = await w.peers.floor.entity();
  const o = await ctx.c.call('open', openArgs(ctx, f, await keyPair()));
  t.diagnostic(`requests the provider made to the floor-only peer: ${w.peers.floor.requests.map(r => r.method + ' ' + new URL(r.url).pathname).join(', ') || 'none'}`);
  assert.ok(o.result?.certificate, JSON.stringify(o.error ?? o));
  assert.equal(part(o.result.certificate, 1).aud, f.identity, 'certified toward the floor peer identity');
});

// ==== §6.2 control statements inbound ================================================================================
test('§6.2/§6.3 a control statement from the session party ends the session; one signed by another key or party is ignored', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const e = w.peer.entities.get(s.from.sub), mallory = await w.peer.entity();
  const sigSigned = await w.peer.control({sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt, signer: e.sig});
  const otherParty = await w.peer.control({sub: mallory.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt});
  for (const c of [sigSigned, otherParty]) assert.equal((await w.peer.post(w.peer.batch({controls: [c]}))).status, 202);
  const still = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false});
  if (!still.got || ctx.has(x => x.sid === s.sid && x.type === 'state')) diverge(t, {section: '§6.3 ("A certification key verifies only with use: cert"; "only from the session party it expects")', request: 'controls signed by the identity sig key and by another entity\'s cert key', observed: 'session ended or stalled', expected: 'both ignored', side: 'implementation'});
  const good = await w.peer.control({sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, leg: s.peerLeg.jkt, reason: 'revoked'});
  assert.equal((await w.peer.post(w.peer.batch({controls: [good]}))).status, 202);
  const ended = await ctx.waitEvent(x => x.sid === s.sid && x.type === 'state' && x.state === 'ended', 5000);
  assert.ok(ended, 'the party\'s control ends the session');
  const after = await peerSend(ctx, s, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false}, {timeout: 1500});
  assert.equal(after.got, false, 'nothing from the ended leg is accepted again');
});

// ==== additional MUSTs ===============================================================================================
test('§7.2 invite body rules: answer_by, context, params, profile, kind, basis and a non-null to are refused', async t => {
  const ctx = await callee(); await beacon(ctx);
  const otherKind = {...KIND, version: 2, digest: 'sha256-' + b64(new Uint8Array(32).fill(7))};
  const cases = [
    ['answer_by 300 s after iat', await invite(ctx, {answerIn: 300}), '§7.2 ("answer_by ... at most iat + 120")'],
    ['answer_by not after iat', await invite(ctx, {answerIn: 0}), '§7.2 ("answer_by ... after iat")'],
    ['context invalid against the kind\'s data schema', await invite(ctx, {bodyOverride: {context: {call: 'not-a-uuid'}}}), '§7.2 ("context ... valid against the kind\'s data schema")'],
    ['params with an unknown member', await invite(ctx, {params: {offer: null, extra: 1}}), '§16.3 ("Invite params: exactly {offer}")'],
    ['params without offer', await invite(ctx, {params: {}}), '§16.3 ("Invite params: exactly {offer}")'],
    ['params.offer not a string', await invite(ctx, {params: {offer: {sdp: 'x'}}}), '§16.3'],
    ['profile data, which the kind does not list', await invite(ctx, {profile: 'data', params: {}}), '§3.4/§5.1 item 5, §9.2 step 7'],
    ['an unregistered profile', await invite(ctx, {profile: 'video', params: {}}), '§3.5 (registered profiles only), §7.2'],
    ['a kind version the provider does not hold', await invite(ctx, {kind: otherKind}), '§3.4 ("An invite whose kind version is not held is not delivered")'],
    ['a kind whose digest does not match the held version', await invite(ctx, {kind: {...KIND, digest: otherKind.digest}}), '§3.4, artefacts §5'],
    ['a kind reference with an unknown member', await invite(ctx, {kind: {...KIND, extra: 1}}), '§7.2 (kind {artefact, version, digest})'],
    ['invite with a non-null to', await invite(ctx, {msgOverride: {to: randomId(32)}}), '§7.1 ("to ... is null only for invite and cancel")'],
    ['basis with an unknown member', await invite(ctx, {basis: {offer_digest: b64(new Uint8Array(32)), extra: 1}}), '§5.2 basis wire'],
    ['basis relation other than pairing', await invite(ctx, {basis: {relation: 'contact'}}), '§5.2 ("Relation values other than pairing ... are reserved")']
  ];
  for (const [label, inv, section] of cases) await dropped(t, ctx, label, inv, section);
});

test('§8.2 fan-out and first claim within one routing set: two eligible endpoints, exactly one claim wins, the other is told only "claimed"', async t => {
  // §5.4 case 3: an offer whose minting endpoint is no longer eligible routes to the minting app's eligible endpoints.
  const ctx = await callee(), ep2 = await ctx.register(), minter = await ctx.register();
  const {offers} = await ctx.mint({uses: 4}, minter.ep);
  assert.equal((await ctx.c.call('unregister', minter.ep)).status, 200, 'the minting endpoint unregisters (the offer survives, §5.7)');
  const inv = await invite(ctx, {token: offers[0].offer}); assert.ok(await deliver(ctx, inv), 'delivered to endpoint 1');
  assert.ok(await ep2.waitEvent(e => e.sid === inv.sid && e.type === 'invite', 5000), 'fanned out to endpoint 2');
  const [a, b] = await Promise.all([ctx.c.call('claim', {...ctx.ep, sid: inv.sid, outcome: 'accept', delegate: (await keyPair()).jwk}), ctx.c.call('claim', {...ep2.ep, sid: inv.sid, outcome: 'accept', delegate: (await keyPair()).jwk})]);
  const winners = [a, b].filter(r => r.result?.certificate), losers = [a, b].filter(r => !r.result?.certificate);
  assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify([a.error, b.error])}`);
  assert.equal(losers[0].error?.code, 'claimed', JSON.stringify(losers[0].error ?? losers[0]));
  const loser = losers[0] === b ? ep2 : ctx; await loser.poll(1);
  const st = loser.events.find(e => e.sid === inv.sid && e.type === 'state');
  t.diagnostic(`losing endpoint state event: ${JSON.stringify(st ? {state: st.state} : null)}`);
});

test('§7.3 more than 32 messages buffered ahead of a gap end the leg with failed', async t => {
  const ctx = await callee(), inv = await invite(ctx); assert.ok(await deliver(ctx, inv)); const s = await accept(ctx, inv);
  const gapAt = s.peerSeq, item = {gen: 0, items: [candidateItem(candidate())], complete: false};
  const msgs = []; for (let i = 1; i <= 33; i++) msgs.push(await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: gapAt + i, type: 'candidates', body: item}));
  assert.equal((await w.peer.post(w.peer.batch({messages: msgs.slice(0, 32)}))).status, 202);
  const early = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state', 1000);
  assert.equal(early, null, '32 buffered messages do not end the leg');
  const t0 = Date.now(); assert.equal((await w.peer.post(w.peer.batch({messages: [msgs[32]]}))).status, 202);
  const ended = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state' && e.state === 'ended', 6000);
  if (!ended) diverge(t, {section: '§7.3 ("It buffers at most 32 messages ahead of a gap")', request: 'a gap, then 33 later messages', observed: 'leg not ended within 6 s of the 33rd', expected: 'leg ended (failed) once a 33rd message is ahead of the gap', side: 'implementation'});
  else t.diagnostic(`ended ${Date.now() - t0} ms after the 33rd message`);
});

test('§7.2/§10.2 the provider refuses its own endpoint\'s invite with answer_by beyond iat + 120', async t => {
  const ctx = await callee(), appLeg = await keyPair(), token = w.peer.mintOffer();
  const o = await ctx.c.call('open', openArgs(ctx, ctx.bob, appLeg, {token})); assert.ok(o.result?.certificate, JSON.stringify(o));
  const s = {sid: part(o.result.certificate, 1).sid, appLeg, peerIdentity: ctx.bob.identity}, kind = part(o.result.certificate, 1).kind;
  const m = await appMessage(ctx, s, {seq: 0, type: 'invite', to: null, body: {kind, profile: 'webrtc', answer_by: now() + 300, basis: {offer_digest: await offerDigest(token)}, context: null, params: {offer: sdp()}}});
  const r = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [m]});
  await sleep(300);
  t.diagnostic(`send -> ${JSON.stringify(r.error ?? r.result)}`);
  if (r.result?.accepted === 1 || w.peer.messages(s.sid).some(x => x.jws === m)) diverge(t, {section: '§7.2, §10.2 send ("applies §7 and the profile\'s rules ... before relaying, and refuses violations with invalid_args")', request: 'send of an invite with answer_by iat + 300', observed: 'accepted or relayed', expected: 'refused with invalid_args', side: 'implementation'});
  else assert.equal(r.error?.code, 'invalid_args');
});

test('§7.3 AMD-RI3: a message whose to names no leg of the session is dropped and consumes its seq', async t => {
  const ctx = await callee(), s = await openCall(ctx); assert.ok(s.received);
  const ans = await peerAnswer(ctx, s); assert.ok(await ctx.waitEvent(x => x.message === ans.m), 'connected');
  const mk = (seq, ty, b, o = {}) => w.peer.message({leg: ans.leg, sub: s.to.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq, type: ty, body: b, ...o});
  const good = {gen: 0, items: [candidateItem(candidate())], complete: true};
  const bad = await mk(1, 'candidates', good, {to: randomId(32)});
  const status = (await w.peer.post(w.peer.batch({messages: [bad]}))).status;
  const next = await mk(2, 'candidates', good); await w.peer.post(w.peer.batch({messages: [next]}));
  const consumed = !!await ctx.waitEvent(x => x.message === next, 3000);
  t.diagnostic(`to naming no leg: post ${status}; seq ${consumed ? 'consumed' : 'not consumed'}`);
  assert.equal(ctx.has(x => x.message === bad), false, 'a message whose to names no leg of the session is not delivered');
  assert.ok(consumed, 'the dropped message consumed its seq, as other step-7 drops do');
});

test('§3.2/§10.1 an application can request the signaling fragment on a provider that declares the signaling extension, without operator-registered documents', async () => {
  // The shared world registers no fragment or contract document (only the session kind); this request is the first step
  // every other test in the suite takes.
  const acct = await w.account(), verifier = randomUUID() + randomUUID(), challenge = createHash('sha256').update(verifier).digest('base64url');
  const r = await w.post('/api/oauth/requests', {clientId: APP.id, redirectUri: APP.redirectUris[0], challenge, challengeMethod: 'S256', state: 's', identity: acct.handle + '@provider.example', requests: [{fragment: FRAGMENT, required: true, purpose: 'Sessions', fields: ['signaling'], methods: {signaling: {[CONTRACT]: METHODS}}}]}, {appOrigin: APP.origin, ip: acct.ip});
  const body = await r.json();
  assert.equal(r.status, 201, JSON.stringify(body));
});

