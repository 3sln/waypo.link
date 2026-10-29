// The original tab's half of the cross-device email flow (sign-in and intents spike §4.1, §4.5; P3). Pure helpers, no
// DOM: the browser provider (providers/email-flow.mjs) and the engine-level tests share them.
//
//   S   256 random bits from crypto.getRandomValues, base64url. Kept in this tab's memory and sessionStorage (survives a
//       reload or tab discard), sent only on status, redeem, resend and cancel. The server stores SHA-256(S).
//   T   HMAC-SHA-256(key = S's 32 bytes, "bindle-email-flow-bc"), base64url. Sent at start; the helper learns it only from
//       a same-browser approval. It authenticates BroadcastChannel wake-ups and grants nothing.
export const EMAIL_FLOW_CHANNEL = 'bindle-email-flow';
export const EMAIL_FLOW_STORE = '3sln-email-flow';
export const CHANNEL_TAG_LABEL = 'bindle-email-flow-bc';
const B64 = /^[A-Za-z0-9_-]{43}$/, FLOW_ID = /^[A-Za-z0-9_-]{22}$/;
const encode = bytes => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
/** Constant-time comparison of two strings. */
export function sameValue(a, b) { if (typeof a !== 'string' || typeof b !== 'string') return false; let difference = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return difference === 0; }
/** SHA-256(S) and T for an existing S. */
export async function flowProofs(secret, crypto = globalThis.crypto) {
  if (typeof secret !== 'string' || !B64.test(secret)) throw new TypeError('Invalid flow secret');
  const secretHash = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))));
  const key = await crypto.subtle.importKey('raw', decode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const channelTag = encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(CHANNEL_TAG_LABEL))));
  return { secretHash, channelTag };
}
/** A fresh S with its proofs. */
export async function createFlowSecret(crypto = globalThis.crypto) { const secret = encode(crypto.getRandomValues(new Uint8Array(32))); return { secret, ...await flowProofs(secret, crypto) }; }
/** Whether a BroadcastChannel message is a wake-up for this tab's flow: a known type, this flow's id and this flow's T
 * (constant time). Its only effect is an immediate status poll; success is decided by the server with S (EL-1). */
export function acceptWake(message, { flowId, channelTag }) {
  return Boolean(message) && typeof message === 'object' && message.v === 1 && message.type === 'approved' && typeof message.flowId === 'string' && FLOW_ID.test(message.flowId) && message.flowId === flowId && sameValue(message.tag, channelTag);
}
/** The wake-up the helper posts after a same-browser approval. */
export const wakeMessage = ({ flowId, channelTag }) => ({ v: 1, type: 'approved', flowId, tag: channelTag });
/** The original tab's acknowledgement on the channel, carrying the flow id and T like the wake-up (P3 security review
 * I3), so an unrelated same-origin poster cannot make the helper say "Done" and skip its closed-tab offer. */
export const ackMessage = ({ flowId, channelTag }) => ({ v: 1, type: 'ack', flowId, tag: channelTag });
/** Whether a channel message is the original tab's acknowledgement for this flow: its id and its T (constant time). */
export const acceptAck = (message, { flowId, channelTag }) => Boolean(message) && typeof message === 'object' && message.v === 1 && message.type === 'ack' && typeof message.flowId === 'string' && FLOW_ID.test(message.flowId) && message.flowId === flowId && typeof channelTag === 'string' && B64.test(channelTag) && sameValue(message.tag, channelTag);
/** The stored flow record of the original tab: {v:1, flowId, secret, channelTag, maskedAddress?, expiresAt, interval}. */
export function validStoredFlow(value, now = Date.now()) {
  return Boolean(value) && value.v === 1 && FLOW_ID.test(value.flowId ?? '') && B64.test(value.secret ?? '') && B64.test(value.channelTag ?? '') && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + 900000 && (value.email === undefined || typeof value.email === 'string' && value.email.length <= 254);
}
/** `482 917` for display; R accepts the code with or without the space. */
export const formatCode = code => typeof code === 'string' && /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : '';
