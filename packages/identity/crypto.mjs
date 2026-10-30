const encoder = new TextEncoder();
export function encode(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('Invalid base64url');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export class IdentityCrypto {
  constructor(crypto = globalThis.crypto) { this.crypto = crypto; }
  random(size = 32) { return encode(this.crypto.getRandomValues(new Uint8Array(size))); }
  id() { return this.crypto.randomUUID(); }
  async hash(purpose, value) { return encode(new Uint8Array(await this.crypto.subtle.digest('SHA-256', encoder.encode(`${purpose}\0${value}`)))); }
}

