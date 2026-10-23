// PORT-1: identity portability codec and verification (packages/identity/succession.mjs; docs/spec/identity-portability.md
// rev 3.2 §4, §5, §7.1, §8.3 items 1–3, §8.4, §8.6, §9.1, §10, §12). Unit tests, the public conformance vectors
// (docs/architecture/artefacts/identity-portability.vectors.json) and seeded property tests (tests/helpers/chaos.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { base64url, fromBase64url, textEncoder, canonical } from '../packages/core/records.mjs';
import { forEachSeed } from './helpers/chaos.mjs';
import {
  MOVE_TYP, ATTESTATION_TYP, ATTESTATION_KEY_CONTINUITY_DOMAIN, MAX_MOVES, MAX_PACKAGE_BYTES, SuccessionError,
  statementDigest, signMoveStatement, parseMoveStatement, verifyMoveStatement, signMoveAttestation, parseMoveAttestation, verifyMoveAttestation,
  verifyMoveRecordLink, verifyChain, attestationKeyThumbprint, signAttestationKeyContinuity, verifyAttestationKeyContinuity, evaluateAttestationKeys,
  validatePackage, verifyPackage, validateRedirectBase, redirectablePath, redirectTarget, originalURL,
} from '../packages/identity/succession.mjs';

const SUB = '6f1c2b8e-3d4a-4c5b-9e7f-0a1b2c3d4e5f', A = 'https://a.example', B = 'https://b.example', C = 'https://c.example';
const ES = { name: 'ECDSA', hash: 'SHA-256' }, P = { name: 'ECDSA', namedCurve: 'P-256' };
const code = c => error => error instanceof SuccessionError && error.code === c;
const pair = async () => { const keys = await crypto.subtle.generateKey(P, true, ['sign', 'verify']); const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', keys.publicKey); return { ...keys, publicJwk: { kty, crv, x, y } }; };
const ident = (iss, n = 1) => ({ iss, identity: `${iss}/entities/${SUB}/v${n}` });
const decode = segment => JSON.parse(new TextDecoder().decode(fromBase64url(segment)));
// Unchecked JWS signer for forged/invalid inputs (canonical encoding, raw ES256).
async function rawJWS(header, payload, privateKey) {
  const input = `${base64url(textEncoder.encode(canonical(header)))}.${base64url(textEncoder.encode(canonical(payload)))}`;
  return `${input}.${base64url(new Uint8Array(await crypto.subtle.sign(ES, privateKey, textEncoder.encode(input))))}`;
}
// packages/identity/keys.mjs continuity statement (signer = predecessor).
async function continuity(signerKid, signer, next, at = 1800000000000) {
  const payload = base64url(textEncoder.encode(canonical({ version: 1, subject: SUB, purpose: 'signing', previous: signerKid, signer: signerKid, next: { kid: next.kid, alg: 'ES256', publicJwk: next.publicJwk }, at })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign(ES, signer.privateKey, textEncoder.encode(`3sln-identity-key-continuity-v1.ES256.${signerKid}.${payload}`))));
  return { alg: 'ES256', kid: signerKid, payload, signature };
}
async function attestationKey(kid, signer) {
  const key = await pair(), listed = { ...key.publicJwk, kid, use: 'sig', alg: 'ES256' };
  if (signer) listed.continuity = await signAttestationKeyContinuity({ kid: signer.listed.kid, privateKey: signer.privateKey, next: listed });
  return { ...key, listed };
}

// A two-move world: A -> B -> C. B and C rotate the signing key at activation (k1 -> k2 -> k3, §7.1).
async function world() {
  const k1 = await pair(), k2 = await pair(), k3 = await pair();
  const a1 = await attestationKey('a1'), a2 = await attestationKey('a2', a1), b1 = await attestationKey('b1');
  const s1 = await signMoveStatement({ kid: 'k1', payload: { bindle: 'identity-move', v: 1, sub: SUB, kind: 'person', seq: 1, prev: null, from: ident(A), to: ident(B), iat: 1800000000 } }, k1.privateKey);
  const at1 = await signMoveAttestation({ kid: 'a2', payload: { bindle: 'move-attestation', v: 1, iss: A, sub: SUB, seq: 1, statement: await statementDigest(parseMoveStatement(s1).input), to: ident(B), aep: 3, at: 1800000100 } }, a2.privateKey);
  const s2 = await signMoveStatement({ kid: 'k2', payload: { bindle: 'identity-move', v: 1, sub: SUB, kind: 'person', seq: 2, prev: await statementDigest(parseMoveStatement(s1).input), from: ident(B), to: ident(C), iat: 1800100000 } }, k2.privateKey);
  const at2 = await signMoveAttestation({ kid: 'b1', payload: { bindle: 'move-attestation', v: 1, iss: B, sub: SUB, seq: 2, statement: await statementDigest(parseMoveStatement(s2).input), to: ident(C), aep: 7, at: 1800100100 } }, b1.privateKey);
  const keys = [
    { kid: 'k1', use: 'sig', alg: 'ES256', jwk: k1.publicJwk, state: 'retired', created: 1799000000, retired: 1800000200, predecessor: null, continuity: null },
    { kid: 'k2', use: 'sig', alg: 'ES256', jwk: k2.publicJwk, state: 'retired', created: 1800000200, retired: 1800100200, predecessor: 'k1', continuity: await continuity('k1', k1, { kid: 'k2', publicJwk: k2.publicJwk }) },
    { kid: 'k3', use: 'sig', alg: 'ES256', jwk: k3.publicJwk, state: 'active', created: 1800100200, predecessor: 'k2', continuity: await continuity('k2', k2, { kid: 'k3', publicJwk: k3.publicJwk }) },
  ];
  const jwks = { [A]: { keys: [a1.listed, a2.listed] }, [B]: { keys: [b1.listed] } };
  return { k1, k2, k3, a1, a2, b1, s1, s2, at1, at2, keys, jwks, moves: [{ statement: s1, attestation: at1 }, { statement: s2, attestation: at2 }], input: (over = {}) => ({ moves: [{ statement: s1, attestation: at1 }, { statement: s2, attestation: at2 }], keys, iss: C, identity: ident(C).identity, attestationKeys: issuer => jwks[issuer], ...over }) };
}
let shared; const W = () => shared ??= world();
const statementPayload = (over = {}) => ({ bindle: 'identity-move', v: 1, sub: SUB, kind: 'person', seq: 1, prev: null, from: ident(A), to: ident(B), iat: 1800000000, ...over });

test('move statement: exact header and members, canonical round trip and signature over the received input', async () => {
  const w = await W(), parsed = await verifyMoveStatement(w.s1, w.k1.publicJwk);
  assert.deepEqual(parsed.header, { alg: 'ES256', kid: 'k1', typ: MOVE_TYP });
  assert.deepEqual(Object.keys(parsed.payload).sort(), ['bindle', 'from', 'iat', 'kind', 'prev', 'seq', 'sub', 'to', 'v']);
  assert.equal(parsed.signature.length, 64);
  await assert.rejects(verifyMoveStatement(w.s1, w.k2.publicJwk), code('statement_invalid'), 'another key');
  assert.match(await statementDigest(parsed.input), /^sha256-[A-Za-z0-9_-]{43}$/);
  const k = w.k1.privateKey;
  const invalid = [
    [{ alg: 'ES256', kid: 'k1', typ: 'bindle-link-meta+jwt' }, statementPayload(), 'wrong typ'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP, extra: 1 }, statementPayload(), 'extra header member'],
    [{ alg: 'EdDSA', kid: 'k1', typ: MOVE_TYP }, statementPayload(), 'alg'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, { ...statementPayload(), extra: true }, 'extra member'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, (({ iat, ...rest }) => rest)(statementPayload()), 'missing member'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ kind: 'team' }), 'kind'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ to: ident(A, 2) }), 'from.iss equals to.iss'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ to: { iss: B, identity: `${C}/entities/${SUB}` } }), 'to.identity off the destination origin'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ sub: SUB.toUpperCase() }), 'non-canonical sub'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ prev: 'sha256-' + 'A'.repeat(43) }), 'seq 1 with prev'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ seq: 2, prev: null }), 'seq 2 without prev'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ seq: 0 }), 'seq 0'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ from: { iss: 'http://a.example', identity: 'http://a.example/x' } }), 'plain http'],
    [{ alg: 'ES256', kid: 'k1', typ: MOVE_TYP }, statementPayload({ v: 2 }), 'version'],
  ];
  for (const [header, payload, label] of invalid) { const jws = await rawJWS(header, payload, k); assert.throws(() => parseMoveStatement(jws), code('statement_invalid'), label); }
  for (const [, payload, label] of invalid.slice(3)) await assert.rejects(signMoveStatement({ kid: 'k1', payload }, k), code('statement_invalid'), `signer refuses: ${label}`);
  // Strict I-JSON: a duplicate member, and a short signature.
  const [h, , s] = w.s1.split('.'), dup = base64url(textEncoder.encode(canonical(statementPayload()).replace('{', '{"v":1,')));
  assert.throws(() => parseMoveStatement(`${h}.${dup}.${s}`), code('statement_invalid'));
  assert.throws(() => parseMoveStatement(`${w.s1.split('.').slice(0, 2).join('.')}.${base64url(new Uint8Array(63))}`), code('statement_invalid'));
});

test('move attestation: matches the statement digest, seq, sub, to and issuer; identity keys never attest', async () => {
  const w = await W(), parsed = await verifyMoveAttestation(w.at1, { statement: w.s1, publicJwk: w.a2.listed });
  assert.deepEqual(parsed.header, { alg: 'ES256', kid: 'a2', typ: ATTESTATION_TYP });
  await assert.rejects(verifyMoveAttestation(w.at1, { statement: w.s2, publicJwk: w.a2.listed }), code('attestation_invalid'), 'over another statement');
  const base = parseMoveAttestation(w.at1).payload;
  for (const [change, label] of [[{ to: ident(C) }, 'another to'], [{ seq: 2 }, 'another seq'], [{ iss: B }, 'another issuer'], [{ sub: '00000000-0000-4000-8000-000000000000' }, 'another sub']]) {
    const forged = await signMoveAttestation({ kid: 'a2', payload: { ...base, ...change } }, w.a2.privateKey);
    await assert.rejects(verifyMoveAttestation(forged, { statement: w.s1, publicJwk: w.a2.listed }), code('attestation_invalid'), label);
  }
  const byIdentity = await signMoveAttestation({ kid: 'k1', payload: base }, w.k1.privateKey);
  await assert.rejects(verifyMoveAttestation(byIdentity, { statement: w.s1, publicJwk: w.a2.listed }), code('attestation_invalid'));
  await assert.rejects(verifyChain(w.input({ moves: [{ statement: w.s1, attestation: byIdentity }, w.moves[1]] })), code('attestation_untrusted'), 'an identity kid is not a listed attestation key');
  for (const payload of [{ ...base, aep: -1 }, { ...base, extra: 1 }, { ...base, bindle: 'identity-move' }]) await assert.rejects(signMoveAttestation({ kid: 'a2', payload }, w.a2.privateKey), code('attestation_invalid'));
  assert.throws(() => parseMoveAttestation(w.s1), code('attestation_invalid'), 'a statement is not an attestation');
  assert.throws(() => parseMoveStatement(w.at1), code('statement_invalid'), 'an attestation is not a statement');
});

test('record linkage: seq gaps, prev mismatches, broken from and kind changes fail', async () => {
  const w = await W(), s1 = parseMoveStatement(w.s1), s2 = parseMoveStatement(w.s2);
  assert.equal(await verifyMoveRecordLink(null, s1), true); assert.equal(await verifyMoveRecordLink(s1, s2), true);
  await assert.rejects(verifyMoveRecordLink(null, s2), code('chain_invalid'));
  await assert.rejects(verifyMoveRecordLink(s2, s1), code('chain_invalid'), 'reordered');
  const k = w.k2.privateKey, prev = s2.payload.prev;
  for (const [over, label] of [[{ seq: 3 }, 'gap'], [{ prev: 'sha256-' + 'B'.repeat(43) }, 'prev'], [{ from: ident(A, 3) }, 'from'], [{ kind: 'organization' }, 'kind'], [{ sub: '00000000-0000-4000-8000-000000000000' }, 'sub']]) {
    const forged = parseMoveStatement(await signMoveStatement({ kid: 'k2', payload: { ...s2.payload, prev, ...over, ...over.from ? { to: ident(C) } : {} } }, k));
    await assert.rejects(verifyMoveRecordLink(s1, forged), code('chain_invalid'), label);
  }
});

test('first-contact chain (§8.6): origin principal, head, aep, first-use pins; preconfigured roots and pins are not first use', async () => {
  const w = await W(), result = await verifyChain(w.input());
  assert.deepEqual(result.origin, { iss: A, sub: SUB }); assert.equal(result.kind, 'person'); assert.equal(result.head.seq, 2);
  assert.equal(result.head.digest, await statementDigest(parseMoveStatement(w.s2).input)); assert.equal(result.aep, 7);
  assert.equal(result.attestation_first_use, true);
  assert.deepEqual(Object.keys(result.pins).sort(), [A, B]); assert.equal(result.pins[A].thumbprints.length, 2); assert.equal(result.pins[A].firstUse, true);
  const roots = { [A]: [await attestationKeyThumbprint(w.a1.listed)], [B]: [await attestationKeyThumbprint(w.b1.listed)] };
  const configured = await verifyChain(w.input({ roots }));
  assert.equal(configured.attestation_first_use, false, 'a shipped root is never trusted on first use');
  assert.equal(configured.pins[A].firstUse, false);
  const again = await verifyChain(w.input({ pins: result.pins }));
  assert.equal(again.attestation_first_use, false); assert.deepEqual(again.pins, result.pins);
  const frozen = structuredClone(result.pins); await verifyChain(w.input({ pins: frozen })); assert.deepEqual(frozen, result.pins, 'input pins are not mutated');
});

test('chain refusals: unattested, unknown or revoked keys, rolled-back keys, wrong host, size and order', async () => {
  const w = await W(), [r1, r2] = w.moves;
  await assert.rejects(verifyChain(w.input({ moves: [r1, { statement: w.s2, attestation: null }] })), code('chain_invalid'), 'unattested');
  await assert.rejects(verifyChain(w.input({ moves: [r2, r1] })), code('chain_invalid'), 'reordered');
  await assert.rejects(verifyChain(w.input({ moves: [r1] })), code('chain_invalid'), 'last to is not this host');
  await assert.rejects(verifyChain(w.input({ identity: `${C}/entities/${SUB}/other` })), code('chain_invalid'));
  await assert.rejects(verifyChain(w.input({ moves: Array(MAX_MOVES + 1).fill(r1) })), code('chain_invalid'), 'more than 16 records');
  await assert.rejects(verifyChain(w.input({ attestationKeys: () => undefined })), code('chain_invalid'), 'unreachable attestation keys');
  // A statement key the current document does not list, or lists as revoked, never verifies.
  await assert.rejects(verifyChain(w.input({ keys: w.keys.filter(k => k.kid !== 'k1') })), code('chain_invalid'));
  await assert.rejects(verifyChain(w.input({ keys: w.keys.map(k => k.kid === 'k1' ? { ...k, state: 'revoked' } : k) })), code('chain_invalid'), 'revoked key');
  // A broken continuity statement unlinks the older key from the active one.
  const tampered = w.keys.map(k => k.kid === 'k2' ? { ...k, continuity: { ...k.continuity, signature: base64url(new Uint8Array(64)) } } : k);
  await assert.rejects(verifyChain(w.input({ keys: tampered })), code('chain_invalid'));
  // Two active keys, or none, is not a key set.
  await assert.rejects(verifyChain(w.input({ keys: w.keys.map(k => ({ ...k, state: 'active' })) })), code('chain_invalid'));
  // A later move signed by an ancestor of the earlier move's key is a rollback.
  const s1k2 = await signMoveStatement({ kid: 'k2', payload: parseMoveStatement(w.s1).payload }, w.k2.privateKey), d1 = await statementDigest(parseMoveStatement(s1k2).input);
  const at1k2 = await signMoveAttestation({ kid: 'a2', payload: { ...parseMoveAttestation(w.at1).payload, statement: d1 } }, w.a2.privateKey);
  const back = await signMoveStatement({ kid: 'k1', payload: { ...parseMoveStatement(w.s2).payload, prev: d1 } }, w.k1.privateKey);
  const backAt = await signMoveAttestation({ kid: 'b1', payload: { ...parseMoveAttestation(w.at2).payload, statement: await statementDigest(parseMoveStatement(back).input) } }, w.b1.privateKey);
  await assert.rejects(verifyChain(w.input({ moves: [{ statement: s1k2, attestation: at1k2 }, { statement: back, attestation: backAt }] })), code('chain_invalid'));
  // The same key signing consecutive moves (a host that did not rotate) is not a rollback.
  const s2k2 = await signMoveStatement({ kid: 'k2', payload: { ...parseMoveStatement(w.s2).payload, prev: d1 } }, w.k2.privateKey);
  const at2k2 = await signMoveAttestation({ kid: 'b1', payload: { ...parseMoveAttestation(w.at2).payload, statement: await statementDigest(parseMoveStatement(s2k2).input) } }, w.b1.privateKey);
  assert.equal((await verifyChain(w.input({ moves: [{ statement: s1k2, attestation: at1k2 }, { statement: s2k2, attestation: at2k2 }] }))).head.seq, 2);
  // Private members in an attestation JWKS are refused.
  await assert.rejects(verifyChain(w.input({ attestationKeys: issuer => ({ keys: w.jwks[issuer].keys.map(k => ({ ...k, d: 'x' })) }) })), code('attestation_invalid'));
});

test('attestation-key continuity and pinning (P16, §5.1)', async () => {
  const w = await W();
  assert.equal(await verifyAttestationKeyContinuity({ signer: w.a1.listed, next: w.a2.listed }), true);
  assert.equal(await verifyAttestationKeyContinuity({ signer: w.b1.listed, next: w.a2.listed }), false);
  const broken = { ...w.a2.listed, continuity: { kid: 'a1', sig: base64url(new Uint8Array(64)) } };
  const first = await evaluateAttestationKeys({ issuer: A, jwks: { keys: [w.a1.listed, broken] } });
  assert.deepEqual(first.trusted, [await attestationKeyThumbprint(w.a1.listed)], 'a failing continuity is untrusted');
  const orphan = { ...w.a2.listed, continuity: { kid: 'gone', sig: w.a2.listed.continuity.sig } };
  assert.deepEqual((await evaluateAttestationKeys({ issuer: A, jwks: [w.a1.listed, orphan] })).trusted.length, 1, 'continuity naming an unlisted key is untrusted');
  // Chained from a pinned key: accepted and pinned.
  const rootOnly = await evaluateAttestationKeys({ issuer: A, jwks: [w.a1.listed] });
  assert.equal(rootOnly.firstUse, true);
  const a3 = await attestationKey('a3', w.a2), later = await evaluateAttestationKeys({ issuer: A, jwks: [w.a1.listed, w.a2.listed, a3.listed], pins: rootOnly.pins });
  assert.equal(later.firstUse, false); assert.equal(later.reset, false); assert.equal(later.trusted.length, 3); assert.equal(later.pins[A].thumbprints.length, 3);
  // The pinned root may stop being listed; a key chained from a still-listed pinned key stays trusted.
  assert.equal((await evaluateAttestationKeys({ issuer: A, jwks: [w.a2.listed, a3.listed], pins: later.pins })).trusted.length, 2);
  // A JWKS with a new root and no pinned key is an attestation reset; existing pins are kept.
  const evil = await attestationKey('evil'), reset = await evaluateAttestationKeys({ issuer: A, jwks: [evil.listed], pins: later.pins });
  assert.equal(reset.reset, true); assert.deepEqual(reset.pins, later.pins);
  // A preconfigured root is never pinned on first use, and a JWKS without it is a reset.
  const roots = { [A]: [await attestationKeyThumbprint(w.a1.listed)] };
  assert.equal((await evaluateAttestationKeys({ issuer: A, jwks: [evil.listed], roots })).reset, true);
  assert.equal((await evaluateAttestationKeys({ issuer: A, jwks: [w.a1.listed, w.a2.listed], roots })).firstUse, false);
  for (const jwks of [[{ ...w.a1.listed, use: 'enc' }], [{ ...w.a1.listed, alg: 'ES384' }], [w.a1.listed, { ...w.a2.listed, kid: 'a1' }], [], [{ ...w.a1.listed, d: w.a1.listed.x }]])
    await assert.rejects(evaluateAttestationKeys({ issuer: A, jwks }), code('attestation_invalid'));
  assert.match(ATTESTATION_KEY_CONTINUITY_DOMAIN, /^bindle-attestation-key-continuity-v1$/);
});

test('lapsed-domain fork: refused by a verifier holding the source pin, flagged first use for one that never saw it', async () => {
  const w = await W(), honest = await verifyChain(w.input());
  // Attacker: the unsuperseded k1 file plus A's lapsed domain with a fresh attestation root; the forged chain
  // ends at the attacker's host and lists k1 as its active key.
  const evil = await attestationKey('evil'), E = 'https://evil.example';
  const forged = await signMoveStatement({ kid: 'k1', payload: statementPayload({ to: ident(E) }) }, w.k1.privateKey);
  const forgedAt = await signMoveAttestation({ kid: 'evil', payload: { bindle: 'move-attestation', v: 1, iss: A, sub: SUB, seq: 1, statement: await statementDigest(parseMoveStatement(forged).input), to: ident(E), aep: 3, at: 1800000100 } }, evil.privateKey);
  const fork = { moves: [{ statement: forged, attestation: forgedAt }], keys: [{ ...w.keys[0], state: 'active' }], iss: E, identity: ident(E).identity, attestationKeys: () => ({ keys: [evil.listed] }) };
  await assert.rejects(verifyChain({ ...fork, pins: honest.pins }), code('attestation_reset'));
  await assert.rejects(verifyChain({ ...fork, roots: { [A]: [await attestationKeyThumbprint(w.a1.listed)] } }), code('attestation_reset'));
  const naive = await verifyChain(fork);
  assert.equal(naive.attestation_first_use, true, 'the accepted residual is signalled');
});

test('portable identity package (§9.1): exact members, size, no credentials, key correspondence', async () => {
  const sign = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey(P, true, ['sign'])).privateKey), enc = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])).privateKey);
  const strip = ({ kty, crv, x, y, d }) => ({ kty, crv, x, y, d });
  const pkg = { bindle: 'identity-package', v: 1, sub: SUB, kind: 'person', from: ident(A), keys: { signing: { kid: 'k1', jwk: strip(sign) }, encryption: { kid: 'e1', jwk: strip(enc) } }, transfer: { id: 'tr_0123456789abcdef', exp: 1800604800 } };
  assert.deepEqual(await verifyPackage(pkg), pkg); assert.deepEqual(await verifyPackage(JSON.stringify(pkg)), pkg);
  const { transfer, ...noTransfer } = pkg; await verifyPackage(noTransfer);
  await verifyPackage({ ...pkg, keys: { signing: pkg.keys.signing } });
  for (const [bad, label] of [
    [{ ...pkg, recoveryToken: 'x' }, 'recovery credential'], [{ ...pkg, handle: 'n.1' }, 'handle'],
    [{ ...pkg, keys: { ...pkg.keys, certification: pkg.keys.signing } }, 'certification key'],
    [{ ...pkg, keys: { ...pkg.keys, signing: { ...pkg.keys.signing, jwk: { ...pkg.keys.signing.jwk, d: undefined } } } }, 'public-only'],
    [{ ...pkg, keys: { ...pkg.keys, encryption: { kid: 'k1', jwk: pkg.keys.encryption.jwk } } }, 'shared kid'],
    [{ ...pkg, keys: { ...pkg.keys, encryption: pkg.keys.signing } }, 'identical keys'],
    [{ ...pkg, transfer: { id: 'short', exp: 1 } }, 'transfer id'], [{ ...pkg, transfer: { id: 'tr_0123456789abcdef', exp: 1, extra: 1 } }, 'transfer member'],
    [{ ...pkg, v: 2 }, 'version'], [{ ...pkg, sub: 'not-a-uuid' }, 'sub'], [{ ...pkg, kind: 'bot' }, 'kind'],
    [{ ...pkg, padding: 'x'.repeat(MAX_PACKAGE_BYTES) }, 'size'],
  ]) assert.throws(() => validatePackage(JSON.parse(JSON.stringify(bad))), code('package_invalid'), label);
  assert.throws(() => validatePackage(JSON.stringify(pkg).replace('{', '{"v":1,')), code('package_invalid'), 'duplicate member');
  const other = await crypto.subtle.exportKey('jwk', (await crypto.subtle.generateKey(P, true, ['sign'])).privateKey);
  await assert.rejects(verifyPackage({ ...pkg, keys: { ...pkg.keys, signing: { kid: 'k1', jwk: { ...pkg.keys.signing.jwk, x: other.x, y: other.y } } } }), code('package_invalid'), 'mismatched key material');
});

test('redirects (§5.2, §10): base rules, path and query screening, raw query preserved byte for byte, reconstruction', () => {
  assert.equal(validateRedirectBase('https://b.example/moved/a/', B), 'https://b.example/moved/a/');
  for (const base of ['https://b.example/moved/a', 'https://c.example/moved/', 'http://b.example/moved/', 'https://b.example/moved/?x=1', 'https://b.example/moved/#f', 'https://u:p@b.example/moved/', 'https://b.example/a/../moved/', 'https://b.example/a/%2e%2e/moved/', 'https://b.example/a%2Fb/', 'https://b.example/a%5cb/', 'https://b.example//moved/', 'https://B.example/moved/'])
    assert.throws(() => validateRedirectBase(base, B), code('redirect_invalid'), base);
  const raw = 'bindle_meta=a.b.c&x=%41%2F&y=/?z';
  assert.equal(redirectablePath(`/users/n.1/contact/${SUB}`, raw), true);
  const target = redirectTarget({ redirectBase: 'https://b.example/moved/a/', path: `/users/n.1/contact/${SUB}`, rawQuery: raw });
  assert.equal(target, `https://b.example/moved/a/users/n.1/contact/${SUB}?${raw}`);
  assert.equal(originalURL({ fromIss: A, redirectBase: 'https://b.example/moved/a/', target }), `${A}/users/n.1/contact/${SUB}?${raw}`);
  assert.equal(redirectTarget({ redirectBase: 'https://b.example/m/', path: '/entities/x', rawQuery: '' }), 'https://b.example/m/entities/x?', 'an empty query keeps its ?');
  for (const [path, query] of [['/a/./b', null], ['/a/../b', null], ['/a//b', null], ['/a\\b', null], ['/a/%2e/b', null], ['/a%2Fb', null], ['/a%5Cb', null], ['/a/%2E%2E', null], ['a/b', null], ['/', null], ['/a', 'x y'], ['/a', 'x#y'], ['/a', '%zz'], ['/a b', null]])
    assert.equal(redirectablePath(path, query), false, `${path} ? ${query}`);
  assert.throws(() => redirectTarget({ redirectBase: 'https://b.example/m/', path: '/a/../b' }), code('redirect_invalid'));
  assert.throws(() => originalURL({ fromIss: A, redirectBase: 'https://b.example/m/', target: 'https://b.example/other/a' }), code('redirect_invalid'));
  assert.throws(() => originalURL({ fromIss: A, redirectBase: 'https://b.example/m/', target: 'https://b.example/m/a/%2e%2e/b' }), code('redirect_invalid'));
});

test('public conformance vectors verify and their invalid cases fail with the stated code', async () => {
  const v = JSON.parse(await readFile(new URL('../docs/architecture/artefacts/identity-portability.vectors.json', import.meta.url), 'utf8'));
  assert.match(v.description, /private keys were discarded/i);
  for (const host of JSON.stringify(v).match(/https:\/\/[a-z0-9.-]+/g)) assert.match(host, /\.example$/, host);
  for (const jwk of [...v.identityKeys.map(k => k.jwk), ...Object.values(v.attestationJwks).flatMap(set => set.keys)]) assert.equal(jwk.d, undefined);
  for (const item of v.digests) assert.equal(await statementDigest(item.input), item.digest);
  for (const item of v.thumbprints) assert.equal(await attestationKeyThumbprint(item.jwk), item.thumbprint);
  const result = await verifyChain({ ...v.chain, keys: v.identityKeys, attestationKeys: issuer => v.attestationJwks[issuer] });
  assert.deepEqual({ origin: result.origin, head: result.head, aep: result.aep, attestation_first_use: result.attestation_first_use }, v.chainResult);
  for (const item of v.invalidStatements) assert.throws(() => parseMoveStatement(item.jws), code(item.code), item.name);
  assert.equal((await verifyChain({ ...v.chain, keys: v.identityKeys, attestationKeys: issuer => v.attestationJwks[issuer], roots: v.roots })).attestation_first_use, false, 'configured roots');
  for (const item of v.invalidChains) {
    const { attestationKeysOverride, ...override } = item.override, jwks = attestationKeysOverride ?? v.attestationJwks;
    await assert.rejects(verifyChain({ ...v.chain, keys: v.identityKeys, attestationKeys: issuer => jwks[issuer], ...override }), code(item.code), item.name);
  }
  for (const item of v.redirects) {
    assert.equal(redirectTarget(item.request), item.target);
    assert.equal(originalURL({ fromIss: item.fromIss, redirectBase: item.request.redirectBase, target: item.target }), item.original);
  }
  for (const item of v.unredirectable) assert.equal(redirectablePath(item.path, item.rawQuery), false, item.path);
});

test('seeded properties: tampering any byte, reordering, gaps and equal hosts fail; redirect round trips preserve the query', async () => {
  const w = await W();
  await forEachSeed(40, async random => {
    // Flip one character of either JWS in either record: never verifies as the same chain.
    const which = random.int(4), records = structuredClone(w.moves), field = which % 2 ? 'attestation' : 'statement', record = records[which >> 1];
    const value = record[field], index = random.int(value.length), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
    let replacement; do replacement = alphabet[random.int(alphabet.length)]; while (replacement === value[index]);
    record[field] = value.slice(0, index) + replacement + value.slice(index + 1);
    await assert.rejects(verifyChain(w.input({ moves: records })), error => error instanceof SuccessionError, `tampered ${field} ${which >> 1} at ${index}`);
    // A random permutation other than the identity, or a duplicated record, fails.
    const shuffled = random.shuffle([0, 1]); if (shuffled[0] === 1) await assert.rejects(verifyChain(w.input({ moves: shuffled.map(i => w.moves[i]) })), code('chain_invalid'));
    await assert.rejects(verifyChain(w.input({ moves: [w.moves[random.int(2)], w.moves[random.int(2)], ...w.moves] })), error => error instanceof SuccessionError);
    // Random statement payloads: a seq gap or equal hosts is refused by the signer.
    const seq = 2 + random.int(1000);
    await assert.rejects(signMoveStatement({ kid: 'k1', payload: statementPayload({ seq, prev: null }) }, w.k1.privateKey), code('statement_invalid'));
    const host = random.pick([A, B, C]);
    await assert.rejects(signMoveStatement({ kid: 'k1', payload: statementPayload({ from: ident(host), to: ident(host, 2) }) }, w.k1.privateKey), code('statement_invalid'));
    // Random paths: any dot segment, empty segment, backslash or encoded unsafe octet is never redirectable.
    const safe = () => Array.from({ length: 1 + random.int(8) }, () => 'abcXYZ019-._~!$&()*+,;=:@'[random.int(25)]).join('').replace(/^\.{1,2}$/, 'a');
    const segments = Array.from({ length: 1 + random.int(5) }, safe), poison = random.pick(['.', '..', '', 'a\\b', '%2e', '%2F', '%5c', 'x%2Ey']);
    const poisoned = [...segments]; poisoned.splice(random.int(poisoned.length + 1), 0, poison);
    assert.equal(redirectablePath('/' + poisoned.join('/'), null), false, poisoned.join('/'));
    assert.equal(redirectablePath('/' + segments.join('/'), null), true, segments.join('/'));
    const query = Array.from({ length: random.int(40) }, () => random.pick(['a', 'Z', '0', '=', '&', '/', '?', '%41', '%2F', '-', '.', '_', '~', ':', '@', '+'])).join('');
    const base = `https://b.example/moved/${random.int(1000)}/`, path = '/' + segments.join('/');
    const target = redirectTarget({ redirectBase: validateRedirectBase(base, B), path, rawQuery: query });
    assert.equal(originalURL({ fromIss: A, redirectBase: base, target }), `${A}${path}?${query}`);
    assert.equal(new URL(target).search, query ? `?${query}` : '');
  });
});
