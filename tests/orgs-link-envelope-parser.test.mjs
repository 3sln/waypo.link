// The Organizations link envelope's raw-query parser and the strict-JSON parser it uses (packages/orgs/link-envelope.mjs,
// contacts spike CR-C2). Audience validity and the replay record were removed with contact links (contacts phase 4).
// Seeded: rerun a failure with CHAOS_SEED=<seed>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkQuery } from '../packages/orgs/link-envelope.mjs';
import { strictIJSON as linkJSON } from '../packages/core/strict-json.mjs';
import { createRandom, forEachSeed } from './helpers/chaos.mjs';

const BASE = Number(process.env.CHAOS_SEED ?? 1);
const B64 = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'];
const b64 = (random, n) => Array.from({ length: n }, () => random.pick(B64)).join('');
const NAMES = ['bindle_meta', 'bindle_data', 'BINDLE_META', 'Bindle_data', '%62indle_meta', 'bindle%5Fmeta', 'bindle_Meta', 'sig', 'SIG', '%73ig', 'bindle_x', 'bindle_', 'bindle', 'x', 'a+b', 'bindle+meta', '', '%zz', '%', '%e2%82', 'é', 'bindle_meta ', ' bindle_meta'];
const value = random => random.pick([
  () => `${b64(random, 1 + random.int(40))}.${b64(random, 1 + random.int(40))}.${b64(random, 1 + random.int(86))}`,
  () => `${b64(random, 3)}.${b64(random, 3)}`, () => '', () => 'a.b.c.d', () => '%41.b.c', () => 'a.b.c=', () => 'a..c',
  () => `${b64(random, 5000)}.a.b`, () => `${b64(random, 2100)}.a.b`, () => 'a.b.c#frag',
])();
function randomTarget(random) {
  const parts = Array.from({ length: random.int(6) }, () => {
    const name = random.pick(NAMES); if (random.chance(0.1)) return name;
    return `${name}=${value(random)}`;
  });
  const query = parts.join(random.chance(0.9) ? '&' : '&&');
  return random.pick([`https://h.example/p?${query}`, `https://h.example/p?${query}#f`, `https://h.example/p#f?${query}`, `https://h.example/p?${query}#?bindle_meta=a.b.c`, `https://h.example/p`]);
}
const bindleish = name => name.toLowerCase().startsWith('bindle_');

test('raw-query parser: seeded fuzz agrees with WHATWG URLSearchParams on every accepted or ignored link', async t => {
  t.diagnostic(`CHAOS_SEED base ${BASE}`);
  const seen = new Set();
  await forEachSeed(4, async random => {
    for (let i = 0; i < 500; i++) {
      const target = randomTarget(random); let result, error;
      try { result = parseLinkQuery(target); } catch (e) { error = e; }
      const params = [...new URL(target).searchParams];
      if (error) {
        // Only the one stable fault, and only when a bindle_ parameter (in any spelling) is present.
        assert.equal(error.code, 'link_malformed', target);
        assert.ok(params.some(([name]) => bindleish(name)) || target.length > 18000, `rejected without a bindle parameter: ${target}`);
        assert.throws(() => parseLinkQuery(target), { code: 'link_malformed' });
        seen.add('malformed'); continue;
      }
      assert.deepEqual(parseLinkQuery(target), result, 'deterministic');
      seen.add(result.form);
      if (result.form === 'none') assert.ok(!params.some(([name]) => bindleish(name) || name.toLowerCase() === 'sig'), target);
      if (result.form === 'legacy') { assert.ok(params.some(([name]) => name.toLowerCase() === 'sig'), target); assert.ok(!params.some(([name]) => bindleish(name)), target); }
      if (result.form === 'link') {
        // Exactly the canonical spellings, once each, and no other bindle_ parameter.
        const bindle = params.filter(([name]) => bindleish(name));
        assert.deepEqual(bindle.filter(([name]) => name === 'bindle_meta').map(([, v]) => v), [result.meta], target);
        assert.deepEqual(bindle.filter(([name]) => name === 'bindle_data').map(([, v]) => v), result.data === undefined ? [] : [result.data], target);
        assert.equal(bindle.length, result.data === undefined ? 1 : 2, target);
        assert.ok(!params.some(([name]) => name.toLowerCase() === 'sig'), target);
        // Re-serializing the parsed parts yields the same parse.
        assert.deepEqual(parseLinkQuery(`https://h.example/p?bindle_meta=${result.meta}${result.data === undefined ? '' : `&bindle_data=${result.data}`}`), result);
      }
    }
  }, { base: BASE });
  for (const form of ['none', 'legacy', 'link', 'malformed']) assert.ok(seen.has(form), `generator reached ${form}`);
});

test('raw-query parser: alternative encodings, duplicates, legacy mixing and size bounds fail closed', () => {
  const meta = `${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(10)}`;
  assert.deepEqual(parseLinkQuery(`https://h.example/?bindle_meta=${meta}`), { form: 'link', meta });
  for (const target of [`?%62indle_meta=${meta}`, `?bindle%5Fmeta=${meta}`, `?BINDLE_META=${meta}`, `?bindle_meta=${meta}&bindle_meta=${meta}`, `?bindle_meta=${meta}&sig=x`, `?bindle_data=${meta}`, `?bindle_meta=${meta}&bindle_other=1`, `?bindle_meta`, `?bindle_meta=${'a'.repeat(4097)}.b.c`, `?bindle_meta=${meta}&bindle_data=${'a'.repeat(2049)}.b.c`, `?bindle_meta=${meta}&pad=${'x'.repeat(8200)}`, 'x'.repeat(18001)])
    assert.throws(() => parseLinkQuery(target), { code: 'link_malformed' }, target);
  // Exact size limits are inclusive.
  const metaAt = `${'a'.repeat(4096 - 4)}.b.c`, dataAt = `${'a'.repeat(2048 - 4)}.b.c`;
  assert.equal(parseLinkQuery(`?bindle_meta=${metaAt}&bindle_data=${dataAt}`).meta, metaAt);
  assert.deepEqual(parseLinkQuery(`?sig=${'x'.repeat(17000)}`), { form: 'legacy' });
  assert.deepEqual(parseLinkQuery('#?bindle_meta=junk'), { form: 'none' });
  for (const bad of [null, 1, {}, undefined]) assert.throws(() => parseLinkQuery(bad), { code: 'link_malformed' });
});

// Mutated JSON: strict parsers may refuse more than JSON.parse, never accept something different.
function mutateJSON(random) {
  const leaf = () => random.pick([0, 1, -1, 1.5, 1e21, 2 ** 53, 'x', 'é', '😀', true, false, null, '__proto__']);
  const build = depth => depth > 3 || random.chance(0.3) ? leaf() : random.chance(0.5) ? Array.from({ length: random.int(4) }, () => build(depth + 1)) : Object.fromEntries(Array.from({ length: random.int(4) }, () => [random.pick(['a', 'b', '__proto__', 'é', '']), build(depth + 1)]));
  let text = JSON.stringify(build(0));
  for (let n = random.int(4); n > 0; n--) {
    const at = random.int(text.length + 1), piece = random.pick(['"', ',', '{', '}', '[', ']', ':', '\\', '\\u', '\\ud800', '0', '-', '.', 'e', ' ', '\u0000', '﻿', '"a":1,', 'tru']);
    text = random.chance(0.5) ? text.slice(0, at) + piece + text.slice(at) : text.slice(0, at) + text.slice(at + 1);
  }
  return text;
}
test('strict JSON parsers: seeded differential against JSON.parse, bounded depth, only typed faults', async t => {
  t.diagnostic(`CHAOS_SEED base ${BASE}`);
  const outcomes = { accepted: 0, refused: 0 };
  await forEachSeed(4, async random => {
    for (let i = 0; i < 400; i++) {
      const text = mutateJSON(random);
      let reference; try { reference = { value: JSON.parse(text) }; } catch { reference = null; }
      for (const [parse, code] of [[linkJSON, 'invalid_json']]) {
        let parsed; try { parsed = { value: parse(text) }; } catch (error) { assert.ok([code, 'too_large'].includes(error.code), `${error.code} for ${JSON.stringify(text)}`); outcomes.refused++; continue; }
        outcomes.accepted++;
        assert.ok(reference, `strict parser accepted invalid JSON ${JSON.stringify(text)}`);
        assert.deepEqual(parsed.value, reference.value, JSON.stringify(text));
      }
    }
  }, { base: BASE });
  assert.ok(outcomes.accepted > 100 && outcomes.refused > 100, JSON.stringify(outcomes));
  for (const deep of ['['.repeat(10000), '{"a":'.repeat(10000), `${'['.repeat(18)}${']'.repeat(18)}`]) {
    assert.throws(() => linkJSON(deep), { code: 'invalid_json' });
  }
});

// Annex §3.1 issuance rule (2026-10-28 review, CR-C2 verdict; provisional): the signer emits ES256 low-S only (WebCrypto
// returns either S, so roughly half of unnormalized signatures are high-S), refuses EdDSA issuance, and the verifier still
// accepts a stored legacy high-S meta while single use stays keyed on `jti` and the exact bytes.
test('meta issuance: ES256 low-S only, EdDSA issuance refused, a legacy high-S meta still verifies', async () => {
  const { signLinkJWS, parseLinkMeta, verifyLinkSignature, LINK_META_TYP } = await import('../packages/orgs/link-envelope.mjs');
  const { lowS } = await import('../packages/core/signed-object.mjs');
  const { base64url, fromBase64url } = await import('../packages/core/records.mjs');
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Math.floor(Date.now() / 1000), claims = i => ({ bindle: 'link-meta', v: 1, type: 'https://spec.bindle.example/links/org-invitation/v1', iss: 'https://h.example', aud: 'https://h.example/p', jti: `j${i}`, iat: now, exp: now + 60 });
  const header = { alg: 'ES256', kid: 'k1', typ: LINK_META_TYP };
  for (let i = 0; i < 48; i++) {
    const meta = await signLinkJWS({ header, claims: claims(i), privateKey: pair.privateKey });
    assert.equal(lowS(fromBase64url(meta.split('.')[2])), true, `signature ${i} is low-S`);
    assert.equal(await verifyLinkSignature(crypto, parseLinkMeta(meta), { alg: 'ES256', publicJwk }), true);
  }
  await assert.rejects(signLinkJWS({ header: { ...header, alg: 'EdDSA' }, claims: claims(99), privateKey: pair.privateKey }), { code: 'invalid_token' });
  // A legacy high-S twin (r, n - s) of a meta still verifies; its bytes differ, so exact-bytes single use refuses it.
  const meta = await signLinkJWS({ header, claims: claims(100), privateKey: pair.privateKey }), [h, c, sig] = meta.split('.'), bytes = fromBase64url(sig);
  const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n; let s = 0n; for (const b of bytes.subarray(32)) s = (s << 8n) | BigInt(b);
  let v = N - s; const twin = new Uint8Array(bytes); for (let i = 63; i >= 32; i--) { twin[i] = Number(v & 255n); v >>= 8n; }
  const high = `${h}.${c}.${base64url(twin)}`;
  assert.equal(lowS(twin), false); assert.notEqual(high, meta);
  assert.equal(await verifyLinkSignature(crypto, parseLinkMeta(high), { alg: 'ES256', publicJwk }), true, 'stored legacy high-S metas still verify');
});
