// A software WebAuthn authenticator for HTTP- and Worker-level tests (passwords were dropped, owner approval 2026-10-28,
// so every test account signs up and signs in with a passkey). It produces SimpleWebAuthn-shaped JSON responses that the
// real adapter (packages/identity/webauthn.mjs) verifies: `none` attestation, ES256 (P-256), user present and verified,
// a counter that increases per assertion, and the origin / RP ID the service is configured with. It is a test resource
// only; it proves the protocol path, not any real authenticator's behaviour.
import { webcrypto } from 'node:crypto';
const subtle = webcrypto.subtle;
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const utf8 = text => new TextEncoder().encode(text);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
// Minimal CBOR (major types 0, 1, 2, 3, 5) for attestation objects and COSE keys.
function head(major, n) { if (n < 24) return Uint8Array.of(major << 5 | n); if (n < 256) return Uint8Array.of(major << 5 | 24, n); if (n < 65536) return Uint8Array.of(major << 5 | 25, n >> 8, n & 255); return Uint8Array.of(major << 5 | 26, n >>> 24, n >> 16 & 255, n >> 8 & 255, n & 255); }
function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const bytes = utf8(value); return concat(head(3, bytes.length), bytes); }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (value instanceof Map) return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  throw new TypeError('Unsupported CBOR value');
}
const sha256 = async bytes => new Uint8Array(await subtle.digest('SHA-256', bytes));
// WebCrypto ECDSA signatures are r||s; WebAuthn wants ASN.1 DER.
function der(raw) { const int = bytes => { let i = 0; while (i < bytes.length - 1 && bytes[i] === 0) i++; let v = bytes.slice(i); if (v[0] & 0x80) v = concat(Uint8Array.of(0), v); return concat(Uint8Array.of(2, v.length), v); }; const body = concat(int(raw.slice(0, 32)), int(raw.slice(32))); return concat(Uint8Array.of(0x30, body.length), body); }

/** One authenticator holding any number of credentials for `rpID`, presenting client data for `origin`. */
export function softAuthenticator({ origin, rpID = new URL(origin).hostname } = {}) {
  const credentials = new Map();
  let created = 0;
  const clientData = (type, challenge) => utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    credentials,
    /** A registration response for `options` (the server's registrationOptions, or {registrationOptions}). */
    async register(options, { id } = {}) {
      const o = options?.registrationOptions ?? options;
      const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const jwk = await subtle.exportKey('jwk', keys.publicKey);
      const rawId = id ? utf8(id).slice(0, 64) : webcrypto.getRandomValues(new Uint8Array(32));
      const credentialId = b64(rawId);
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
      const authData = concat(await sha256(utf8(o.rp?.id ?? rpID)), Uint8Array.of(0x45), Uint8Array.of(0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(rawId.length >> 8, rawId.length & 255), rawId, cose);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      credentials.set(credentialId, { privateKey: keys.privateKey, counter: 0, userHandle: o.user?.id, order: ++created });
      return { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64(clientData('webauthn.create', o.challenge)), attestationObject: b64(attestationObject), transports: ['internal'] } };
    },
    /** An assertion for `options` (authenticationOptions, or {authenticationOptions}) with `credentialId` (default: the
     * most recently registered credential). */
    async authenticate(options, credentialId) {
      const o = options?.authenticationOptions ?? options;
      const id = credentialId ?? [...credentials].sort((a, b) => b[1].order - a[1].order)[0]?.[0];
      const credential = credentials.get(id); if (!credential) throw new Error('No such soft passkey');
      credential.counter++;
      const authData = concat(await sha256(utf8(o.rpId ?? rpID)), Uint8Array.of(0x05), Uint8Array.of(credential.counter >>> 24, credential.counter >> 16 & 255, credential.counter >> 8 & 255, credential.counter & 255));
      const data = clientData('webauthn.get', o.challenge);
      const signature = der(new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, credential.privateKey, concat(authData, await sha256(data)))));
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(signature), ...credential.userHandle ? { userHandle: credential.userHandle } : {} } };
    },
  };
}

/**
 * HTTP sign-up and step-up with a soft passkey. `send(path, data)` posts JSON with whatever cookies, CSRF header and
 * client address the test uses and resolves the parsed JSON body (or throws on a non-2xx answer, as the test prefers).
 *   pending = await send('/api/auth/signup', signupBody({...}))      method 'passkey'; any password fields are dropped
 *   await registerPending(authenticator, send, pending)                  POST /api/auth/passkey/register
 *   await passkeyStepUp(authenticator, send)                             POST /api/auth/step-up/begin, then /api/auth/step-up
 *   await passkeySignIn(authenticator, send, handle, extra)              POST /api/auth/login/passkey/begin, then /finish
 */
export const signupBody = ({ password, ...body }) => ({ ...body, method: 'passkey' });
export async function registerPending(authenticator, send, pending, { label } = {}) {
  const response = await authenticator.register(pending.registrationOptions);
  return send('/api/auth/passkey/register', { pendingToken: pending.pendingToken, response, ...label ? { label } : {} });
}
export async function passkeyStepUp(authenticator, send, credentialId) {
  const begin = await send('/api/auth/step-up/begin', {});
  return send('/api/auth/step-up', { method: 'passkey', response: await authenticator.authenticate(begin.authenticationOptions, credentialId) });
}
export async function passkeySignIn(authenticator, send, handle, extra = {}, credentialId) {
  const begin = await send('/api/auth/login/passkey/begin', { handle, ...extra });
  return send('/api/auth/login/passkey/finish', { challengeToken: begin.challengeToken, response: await authenticator.authenticate(begin.authenticationOptions, credentialId) });
}
