// Encrypted recovery file (docs/3sln/accounts/recovery-file.md): envelope version 2 with a public `fileId` header, and
// the opaque payload version 3 (recovery and transfer spike §4.1, option C, owner approval 2026-10-28). The payload is
// {version:3, issuer, entity, recoveryToken, fileId, issuedAt}: no private keys, no provider proof, no handle. Envelope
// version 1 files (payload v1 and v2) are no longer recognised (owner approval 2026-10-28, Q10).
import { ANSWER_NORMALIZATION, assertFields, normalizeAnswer, validateArray, validateQuestions } from './normalization.mjs';
import { UUID_V4 } from '../core/primitives.mjs';

export { ANSWER_NORMALIZATION, MAX_METADATA_BYTES, MAX_QUESTIONS, MAX_TEXT_BYTES, QUESTION_TYPES, normalizeAnswer, validateQuestions } from './normalization.mjs';

export const RECOVERY_FORMAT = '3sln-recovery';
/** Envelope version: 2 adds the public `fileId` header member (bound into the AAD). */
export const RECOVERY_VERSION = 2;
/** Decrypted payload version: the opaque credential. */
export const RECOVERY_PAYLOAD_VERSION = 3;
/** A file id is 16 random bytes, unpadded base64url (22 characters). Public: it names a file, it unlocks nothing. */
export const RECOVERY_FILE_ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
/** The reset credential `<entity>.<43 base64url characters>` (32 random bytes); only its hash is stored. */
export const RECOVERY_TOKEN = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_PAYLOAD_BYTES = 16 * 1024;
export const KDF_PARAMETERS = Object.freeze({ name: 'argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, keyBytes: 32 });

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const envelopeFields = ['format', 'version', 'fileId', 'normalization', 'questions', 'kdf', 'cipher', 'ciphertext'];
const payloadFields = ['version', 'issuer', 'entity', 'recoveryToken', 'fileId', 'issuedAt'];
const kdfFields = [...Object.keys(KDF_PARAMETERS), 'salt'];

function formatError(message = 'Unsupported or malformed encrypted recovery file.') {
  const error = new TypeError(message); error.code = 'recovery_file_invalid'; return error;
}
function authenticationError() {
  const error = new Error('The file could not be decrypted. Check every answer and the recovery file.');
  error.code = 'recovery_file_authentication_failed'; return error;
}
function encode(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value, minBytes, maxBytes, label) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw formatError(`Invalid ${label}.`);
  let bytes;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
  catch { throw formatError(`Invalid ${label}.`); }
  if (bytes.length < minBytes || bytes.length > maxBytes || encode(bytes) !== value) throw formatError(`Invalid ${label}.`);
  return bytes;
}
function bytesOfJSON(value, maxBytes, label) {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > maxBytes) throw formatError(`${label} is too large.`);
  return bytes;
}
function readEnvelope(input) {
  if (typeof input === 'string') {
    if (input.length > MAX_FILE_BYTES || encoder.encode(input).length > MAX_FILE_BYTES) throw formatError('Recovery file is too large.');
    try { input = JSON.parse(input); } catch { throw formatError('Recovery file must contain valid JSON.'); }
  }
  try {
    // Envelope v1 (payloads v1 and v2, with keys) is withdrawn; say so plainly instead of "malformed".
    if (input && typeof input === 'object' && input.format === RECOVERY_FORMAT && input.version === 1) throw Object.assign(formatError('This recovery file uses an older format that no longer works. Create a new recovery file.'), { legacy: true });
    assertFields(input, envelopeFields, 'encrypted recovery file');
    if (input.format !== RECOVERY_FORMAT || input.version !== RECOVERY_VERSION || input.normalization !== ANSWER_NORMALIZATION) throw formatError();
    if (typeof input.fileId !== 'string' || !RECOVERY_FILE_ID.test(input.fileId)) throw formatError('Invalid recovery file id.');
    const questions = validateQuestions(input.questions);
    assertFields(input.kdf, kdfFields, 'recovery KDF');
    for (const [field, expected] of Object.entries(KDF_PARAMETERS)) if (input.kdf[field] !== expected) throw formatError('Unsupported recovery KDF parameters.');
    const salt = decode(input.kdf.salt, 16, 16, 'recovery salt');
    assertFields(input.cipher, ['name', 'iv'], 'recovery cipher');
    if (input.cipher.name !== 'AES-256-GCM') throw formatError('Unsupported recovery cipher.');
    const iv = decode(input.cipher.iv, 12, 12, 'recovery IV');
    const ciphertext = decode(input.ciphertext, 17, MAX_PAYLOAD_BYTES + 16, 'recovery ciphertext');
    const envelope = {
      format: input.format, version: input.version, fileId: input.fileId, normalization: input.normalization,
      questions, kdf: { ...KDF_PARAMETERS, salt: input.kdf.salt },
      cipher: { name: input.cipher.name, iv: input.cipher.iv }, ciphertext: input.ciphertext,
    };
    bytesOfJSON(envelope, MAX_FILE_BYTES, 'Recovery file');
    return { envelope, salt, iv, ciphertext };
  } catch (error) { if (error.code === 'recovery_file_invalid') throw error; throw formatError(error.message); }
}

// The inspected metadata has not yet been authenticated. Render it as text only.
export function inspectRecoveryFile(input) {
  const { envelope } = readEnvelope(input);
  const { ciphertext, ...header } = envelope;
  return header;
}

function authenticatedHeader(envelope) {
  return encoder.encode(JSON.stringify([
    envelope.format, envelope.version, envelope.fileId, envelope.normalization,
    envelope.questions.map(q => [q.id, q.type, q.prompt, q.hint ?? '']),
    [envelope.kdf.name, envelope.kdf.version, envelope.kdf.memoryKiB,
      envelope.kdf.iterations, envelope.kdf.parallelism, envelope.kdf.keyBytes, envelope.kdf.salt],
    [envelope.cipher.name, envelope.cipher.iv],
  ]));
}

/** Validates an opaque v3 payload (exact members). `issuer` must be an origin (https, or http on loopback); the
 * credential must belong to `entity`. Throws `recovery_file_invalid`; returns a plain copy. Pure. */
export function validateRecoveryPayload(input) {
  if (typeof input === 'string') {
    if (input.length > MAX_PAYLOAD_BYTES || encoder.encode(input).length > MAX_PAYLOAD_BYTES) throw formatError('Recovery payload is too large.');
    try { input = JSON.parse(input); } catch { throw formatError('Recovery payload must contain valid JSON.'); }
  }
  try { assertFields(input, payloadFields, 'recovery payload'); } catch (error) { throw formatError(error.message); }
  if (input.version !== RECOVERY_PAYLOAD_VERSION) throw formatError('Unsupported recovery payload version.');
  let url; try { url = typeof input.issuer === 'string' && input.issuer.length <= 256 ? new URL(input.issuer) : null; } catch { url = null; }
  if (!url || url.origin !== input.issuer || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw formatError('Recovery issuer must be an origin.');
  if (typeof input.entity !== 'string' || !UUID_V4.test(input.entity)) throw formatError('Invalid recovery identity.');
  const token = typeof input.recoveryToken === 'string' ? RECOVERY_TOKEN.exec(input.recoveryToken) : null;
  if (!token || token[1] !== input.entity) throw formatError('Invalid recovery credential.');
  if (typeof input.fileId !== 'string' || !RECOVERY_FILE_ID.test(input.fileId)) throw formatError('Invalid recovery file id.');
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt < 0) throw formatError('Invalid recovery issue date.');
  return { version: input.version, issuer: input.issuer, entity: input.entity, recoveryToken: input.recoveryToken, fileId: input.fileId, issuedAt: input.issuedAt };
}
/** The payload a provider issues; `fileId` and the token come from the provider's random source. Pure. */
export function createRecoveryPayload({ issuer, entity, recoveryToken, fileId, issuedAt }) {
  return validateRecoveryPayload({ version: RECOVERY_PAYLOAD_VERSION, issuer, entity, recoveryToken, fileId, issuedAt });
}
/** SHA-256 (lowercase hex) of the exact bytes of an encrypted file: the download acknowledgement compares the bytes the
 * browser offered for download with the bytes the user picks again, without decrypting either. `input` is the
 * downloaded text (encoded as UTF-8) or the picked file's bytes. */
export async function recoveryFileDigest(input, { crypto = globalThis.crypto } = {}) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes || bytes.length > MAX_FILE_BYTES) throw formatError('Recovery file is too large.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function requireDependencies({ deriveKey, crypto = globalThis.crypto } = {}) {
  if (typeof deriveKey !== 'function') throw new TypeError('An Argon2id key derivation implementation is required.');
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') throw new TypeError('Web Crypto is required.');
  return { deriveKey, crypto };
}

async function keyFromAnswers(questions, answers, salt, deriveKey, crypto, protectHints = false) {
  validateArray(answers, 'Recovery answers');
  if (answers.length !== questions.length) throw new TypeError('Answer every selected recovery question.');
  const normalized = questions.map((question, index) => normalizeAnswer(question.type, answers[index]));
  if (protectHints) {
    for (let i = 0; i < questions.length; i++) {
      const hint = questions[i].hint;
      if (!hint) continue;
      let normalizedHint;
      try { normalizedHint = normalizeAnswer(questions[i].type, hint); } catch { /* Public hints need not be valid typed answers. */ }
      if (hint === answers[i] || normalizedHint === normalized[i]) {
        normalized.fill(null);
        throw new TypeError('A public hint cannot contain the whole recovery answer.');
      }
    }
  }
  const password = bytesOfJSON(['3sln-recovery-answers-v1', questions.map((q, i) => [q.id, q.type, normalized[i]])], 32768, 'Encoded recovery answers');
  let bytes;
  try {
    bytes = await deriveKey({ password, salt, memorySize: KDF_PARAMETERS.memoryKiB,
      iterations: KDF_PARAMETERS.iterations, parallelism: KDF_PARAMETERS.parallelism,
      hashLength: KDF_PARAMETERS.keyBytes, outputType: 'binary' });
    if (!(bytes instanceof Uint8Array) || bytes.length !== KDF_PARAMETERS.keyBytes) throw new TypeError('Argon2id must return exactly 32 key bytes.');
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    password.fill(0);
    if (bytes instanceof Uint8Array) bytes.fill(0);
    normalized.fill(null);
  }
}

export async function encryptRecoveryFile(payload, questions, answers, options) {
  const { deriveKey, crypto } = requireDependencies(options);
  payload = validateRecoveryPayload(payload);
  questions = validateQuestions(questions);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope = { format: RECOVERY_FORMAT, version: RECOVERY_VERSION, fileId: payload.fileId, normalization: ANSWER_NORMALIZATION,
    questions, kdf: { ...KDF_PARAMETERS, salt: encode(salt) }, cipher: { name: 'AES-256-GCM', iv: encode(iv) } };
  const key = await keyFromAnswers(questions, answers, salt, deriveKey, crypto, true);
  const plaintext = bytesOfJSON(payload, MAX_PAYLOAD_BYTES, 'Recovery payload');
  try {
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: authenticatedHeader(envelope), tagLength: 128 }, key, plaintext);
    envelope.ciphertext = encode(new Uint8Array(encrypted));
    return envelope;
  } finally { plaintext.fill(0); }
}

export async function decryptRecoveryFile(input, answers, options) {
  // Reject every untrusted format/parameter/size before invoking the KDF.
  const { envelope, salt, iv, ciphertext } = readEnvelope(input);
  const { deriveKey, crypto } = requireDependencies(options);
  const key = await keyFromAnswers(envelope.questions, answers, salt, deriveKey, crypto);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: authenticatedHeader(envelope), tagLength: 128 }, key, ciphertext));
    const payload = validateRecoveryPayload(decoder.decode(plaintext));
    // The header id is authenticated (AAD); it must also name the payload it wraps.
    if (payload.fileId !== envelope.fileId) throw formatError();
    return payload;
  } catch { throw authenticationError(); }
  finally { plaintext?.fill(0); }
}
