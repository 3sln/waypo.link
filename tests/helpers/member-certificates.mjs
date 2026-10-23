// ORG-4 test helpers: holder keys, DPoP proofs, sealing, and the key-registry store adapter over an account store.
import { base64url, textEncoder } from '../../packages/core/records.mjs';
import { encryptSecret, decryptSecret } from '../../packages/runtime/secrets.mjs';
import { jwkThumbprint } from '../../packages/identity/delegation.mjs';

const ES256 = { name: 'ECDSA', hash: 'SHA-256' }, P256 = { name: 'ECDSA', namedCurve: 'P-256' };
export const KEK = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
export const sealing = { seal: value => encryptSecret(value, KEK), open: value => decryptSecret(value, KEK) };
const encode = value => base64url(textEncoder.encode(JSON.stringify(value)));
let counter = 0;
export const jti = () => `proof-${String(++counter).padStart(12, '0')}-${base64url(crypto.getRandomValues(new Uint8Array(6)))}`;

/** A P-256 holder key: {privateKey, jwk (public, exactly kty/crv/x/y), jkt}. */
export async function holder() {
  const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey), jwk = { kty: 'EC', crv: 'P-256', x, y };
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, jwk, jkt: await jwkThumbprint(jwk) };
}
export async function sha256(text) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(text)))); }
/** An RFC 9449 proof by `key`. `ath` is the credential text (hashed here). `nowMs` is the test clock. */
export async function dpop(key, { htm = 'POST', htu, nowMs, ath, id = jti(), extra = {} }) {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk }, payload = { jti: id, htm, htu, iat: Math.floor(nowMs / 1000), ...ath === undefined ? {} : { ath: await sha256(ath) }, ...extra };
  const head = `${encode(header)}.${encode(payload)}`;
  return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign(ES256, key.privateKey, textEncoder.encode(head))))}`;
}
/** A compact ES256 JWS with an arbitrary header and payload (forgeries and other profiles). */
export async function jws(header, payload, privateKey) {
  const head = `${encode(header)}.${encode(payload)}`;
  return `${head}.${base64url(new Uint8Array(await crypto.subtle.sign(ES256, privateKey, textEncoder.encode(head))))}`;
}
/** The keys.mjs store contract (get/set/delete/list(prefix) -> [{key, value}]) over an account store. */
export const registryStore = metadata => ({ transaction: operation => metadata.transaction(tx => operation({ get: k => tx.get(k), set: (k, v) => tx.put(k, v), delete: k => tx.delete(k), list: async prefix => [...await tx.list({ prefix })].map(([key, value]) => ({ key, value })) })) });
/** Counts ECDSA verifications (a deterministic proxy for the cost of a verification path). */
export function countingCrypto() {
  const counts = { verify: 0 };
  const subtle = new Proxy(crypto.subtle, { get(target, name) { const value = target[name]; if (name === 'verify') return (...args) => { counts.verify++; return value.apply(target, args); }; return typeof value === 'function' ? value.bind(target) : value; } });
  return { counts, crypto: { subtle, getRandomValues: array => crypto.getRandomValues(array), randomUUID: () => crypto.randomUUID() } };
}
