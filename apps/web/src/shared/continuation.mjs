// One sign-in continuation store (sign-in and intents spike §2.2 SI-8, owner-approved 2026-10-28; P1).
//
// The original tab keeps what the person was doing before sign-in in its own `sessionStorage` under one key, never in a
// URL, an email, a cookie or a server record:
//   {v:1, target:'/i', intent:{value, placement}, expiresAt}       an intent link opened while signed out
//   {v:1, target:'/oauth/authorize?request_id=…', expiresAt}       an app authorization entry (`?return_to=`)
// `expiresAt` is at most one hour after capture and is never extended: for an intent it is the intent's own expiry
// (`createIntentBrowser`), for a return target capture time + 1 hour. It replaces the two earlier stores
// (`3sln-intent-continuation`, 1 hour, and `bindle.provider-continuation`, 10 minutes, whose shorter life dropped an
// intent that took longer than 10 minutes to sign in for). Every in-browser sign-in path (passkey, shared sign-in from
// another device, sign-up activation, email link in the same tab) ends in one `resume` step (release.mjs `accept`);
// completing a recovery `discard`s it (SI-8 (c)). Return targets are a closed set; a stored record that is malformed,
// expired or names anything else is dropped unread.
export const CONTINUATION_KEY = '3sln-continuation';
export const CONTINUATION_TTL_MS = 3600000;
export const LEGACY_CONTINUATION_KEYS = Object.freeze(['3sln-intent-continuation', 'bindle.provider-continuation']);
const AUTHORIZE = /^\/oauth\/authorize\?request_id=(?:[0-9a-f-]{36}\.)?[A-Za-z0-9_-]{43}$/;
/** Whether `value` is an allowed return target. */
export const validReturnTarget = value => value === '/i' || typeof value === 'string' && AUTHORIZE.test(value);
const validIntent = intent => intent && typeof intent.value === 'string' && intent.value.length > 0 && intent.value.length <= 65536 && ['query', 'fragment', 'post', 'scheme'].includes(intent.placement);

/** The store over `storage` (a Storage-like {getItem, setItem, removeItem}; failures are swallowed: storage may be
 * blocked) and `now`. */
export function createContinuation({ storage, now = () => Date.now() } = {}) {
  const get = () => { try { return JSON.parse(storage?.getItem(CONTINUATION_KEY) ?? 'null'); } catch { return null; } };
  const set = record => { try { storage?.setItem(CONTINUATION_KEY, JSON.stringify(record)); return true; } catch { return false; } };
  const clear = () => { try { storage?.removeItem(CONTINUATION_KEY); for (const key of LEGACY_CONTINUATION_KEYS) storage?.removeItem(key); } catch {} };
  const valid = record => record?.v === 1 && validReturnTarget(record.target) && Number.isSafeInteger(record.expiresAt) && record.expiresAt > now() && record.expiresAt <= now() + CONTINUATION_TTL_MS && (record.target === '/i' ? validIntent(record.intent) : record.intent === undefined);
  const store = {
    /** The live record, or null (an invalid or expired record is removed). */
    peek() { const record = get(); if (record === null) return null; if (!valid(record)) { clear(); return null; } return record; },
    /** Keeps an intent for after sign-in. `expiresAt` is the intent's expiry; the record never outlives capture + 1 h. */
    saveIntent({ value, placement, expiresAt }) {
      const intent = { value, placement }, at = now(), until = Math.min(Number.isSafeInteger(expiresAt) ? expiresAt : Infinity, at + CONTINUATION_TTL_MS);
      if (!validIntent(intent) || !(until > at)) return false;
      return set({ v: 1, target: '/i', intent, expiresAt: until });
    },
    /** A `?return_to=` entry. An app authorization target replaces whatever was kept. `/i` keeps a live intent record
     * (the intent page wrote it a moment earlier) and is otherwise meaningless, so it keeps nothing. */
    saveReturn(target) {
      if (target === '/i') { if (store.peek()?.target !== '/i') clear(); return false; }
      clear(); if (!validReturnTarget(target)) return false;
      return set({ v: 1, target, expiresAt: now() + CONTINUATION_TTL_MS });
    },
    /** The intent page's read: the kept intent (once), or null. */
    takeIntent() { const record = store.peek(); if (record?.target !== '/i') return null; clear(); return { ...record.intent, expiresAt: record.expiresAt }; },
    /** The shared sign-in completion step: navigates to the kept target and answers true, or answers false. An intent
     * record stays for the intent page to take; an authorization record is consumed here. */
    resume(navigate) { const record = store.peek(); if (!record) return false; if (record.target !== '/i') clear(); navigate(record.target); return true; },
    /** Drops whatever is kept (recovery completion, sign-out of the tab's flow). */
    discard() { clear(); },
  };
  return store;
}
