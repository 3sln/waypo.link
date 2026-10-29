// Cross-device email sign-in link and email sign-up (sign-in and intents spike §3.4, §3.6, §4, §5; phase P3).
// Direction owner-approved 2026-10-28 (DEVLOG "Owner approvals and directions: rules effects, sign-in, recovery and
// transfer"); the protocol below is the spike's provisional, hardened design, behind EMAIL_FLOW_V2 (and EMAIL_SIGNUP_ENABLED
// for the create-account branch), both default off.
//
// Actors and secrets (spike §4.1):
//   R  the original tab. It generates the per-flow secret S (256 bits) and sends only SHA-256(S) and the channel tag
//      T = HMAC-SHA-256(S, "bindle-email-flow-bc") at start; S itself travels only on status, redeem, resend and cancel.
//   H  the helper page (/email/link) opened from the mail in any browser. It never creates a session by itself (EL-1),
//      except the explicit same-browser "sign in here instead" fallback (complete-here), which needs B.
//   B  the browser marker, a `__Host-` HttpOnly SameSite=Strict cookie the route sets at start; the record keeps only a
//      keyed hash. It is checked on H's POSTs (never on a GET) and again at approve.
//   L  the link token, 256 bits, only in the mail URL's fragment; the record keeps only HMAC(K_link, L) as its index.
//   C  the 6-digit transfer code, created at the first reveal. The record keeps HMAC(K_code, flowId|C) and a random nonce
//      from which the server re-derives C for a repeated reveal (at most 3), so C itself is never stored.
//
// Flow record (provider-wide store keyed by flowId; created on every start, including the non-mailing branches):
//   {flowId, revision, purpose:'sign-in'|'sign-up'|'inert', accountId?, address?, signInSince?, securityEpochAtStart?,
//    locale, secretHash, channelTag, browserHash, linkIndex, linkGeneration, mailbox, requester:{uaSummary,
//    approxLocation, createdAt, networkPrefixHash}, state:'pending'|'approved-same-browser'|'code-revealed'|'redeemed'|
//    'cancelled'|'locked'|'expired', codeHash?, codeNonce?, codeExpiresAt?, codeAttempts, reveals, inspects, resends,
//    createdAt, expiresAt (createdAt + 15 min), linkExpiresAt (sent + 10 min), outcome?, redeemedVia?, signupHash?,
//    signupUntil?, signupUsedAt?}
//   `mailbox` is a keyed pseudonym of the typed address (resend budgets on every branch). No intent, return URL or
//   account data beyond the sign-in binding is ever stored (EL-8). Terminal flows are purged by the store 24 h after
//   expiry.
//
// Invariants (EL-1..EL-8) are enforced below; every transition is a compare-and-swap on the record (EL-5). Every failure
// of an endpoint is one generic error (EL-7). Status never writes, so inert and live flows poll identically.
//
// Store port `emailFlows` (Node and Worker adapters: packages/runtime/email-flow-store.mjs):
//   create(record) → boolean        refuses an existing flowId
//   get(flowId) → record | null
//   compareAndSwap(flowId, revision, record) → boolean
//   putLink(linkIndex, flowId, purgeAt) → void      an immutable pointer; a stale one is detected by `linkIndex`
//   findByLink(linkIndex) → flowId | null
import { secureEqual, encode, decode } from './crypto.mjs';
import { signInEmails } from './emails.mjs';
import { interactiveIdentity } from './organizations.mjs';
import { linkedNetwork } from './linked-approval.mjs';

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
export const EMAIL_FLOW = Object.freeze({ flowMs: 15 * MINUTE, linkMs: 10 * MINUTE, codeMs: 5 * MINUTE, interval: 3, codeAttempts: 5, reveals: 3, inspects: 10, resends: 3, retentionMs: DAY, signupMs: 30 * MINUTE, completeHereMs: 2000 });
export const EMAIL_FLOW_LIMITS = Object.freeze({
  // spike §4.7: at most 3 live flows per address and per browser (a flow lives 15 minutes).
  address: { windowMs: 15 * MINUTE, limit: 3 }, browser: { windowMs: 15 * MINUTE, limit: 3 },
  // resend counts as a send: a per-mailbox window on every branch, beside the per-flow cap.
  send: { windowMs: 15 * MINUTE, limit: 5 },
  inspect: { windowMs: 10 * MINUTE, limit: 30 },
  // 20 failed code redemptions per hour per network prefix (IPv4 /24, IPv6 /64).
  redeemPrefix: { windowMs: HOUR, limit: 20 },
  // the link-free notice to a verified (not sign-in) address, and the sign-up-closed notice: at most one per 24 h.
  notice: { windowMs: DAY, limit: 1 },
  globalWindowMs: HOUR, slotMs: 15 * MINUTE,
});
export const CODE_SPACE = 1e6, LIVE_SHARDS = 8, LIVE_CAP = 20000;
/** Global failed-code budget per hour, scaled to the live `code-revealed` flows (device authorization §10.3's approach),
 * with a floor: every guess already needs its flow's S and each flow locks after 5 wrong codes, so the global budget is a
 * backstop against mass guessing across many flows. Spending it (at most 10% of one code space per hour across all live
 * codes, never under 1,000 guesses) makes every further code redemption present a fresh Turnstile proof. */
export const GLOBAL_REDEEM_FLOOR = 1000;
export const globalRedeemBudget = live => Math.max(GLOBAL_REDEEM_FLOOR, Math.floor(0.1 * CODE_SPACE / Math.max(1, live)));
export const CHANNEL_TAG_LABEL = 'bindle-email-flow-bc';
const B64 = /^[A-Za-z0-9_-]{43}$/, FLOW_ID = /^[A-Za-z0-9_-]{22}$/, SIGNUP_TOKEN = /^es1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const live = state => ['pending', 'approved-same-browser', 'code-revealed'].includes(state);

/** In-memory store with the port contract: tests and single-process embeddings only. */
export class MemoryEmailFlows {
  constructor(clock = () => Date.now()) { this.clock = clock; this.flows = new Map(); this.links = new Map(); }
  purge() { const now = this.clock(); for (const [id, value] of this.flows) if (value.purgeAt <= now) this.flows.delete(id); for (const [key, value] of this.links) if (value.purgeAt <= now) this.links.delete(key); }
  async create(record) { this.purge(); if (this.flows.has(record.flowId)) return false; this.flows.set(record.flowId, { record: structuredClone(record), purgeAt: record.expiresAt + EMAIL_FLOW.retentionMs }); return true; }
  async get(id) { this.purge(); const value = this.flows.get(id); return value ? structuredClone(value.record) : null; }
  async compareAndSwap(id, revision, record) { const value = this.flows.get(id); if (!value || value.record.revision !== revision) return false; value.record = structuredClone(record); return true; }
  async putLink(index, flowId, purgeAt) { this.links.set(index, { flowId, purgeAt }); }
  async findByLink(index) { this.purge(); return this.links.get(index)?.flowId ?? null; }
}

const BROWSERS = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['SamsungBrowser/', 'Samsung Internet'], ['Firefox/', 'Firefox'], ['FxiOS/', 'Firefox'], ['CriOS/', 'Chrome'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']];
const SYSTEMS = [['iPad', 'iPadOS'], ['iPhone', 'iOS'], ['Android', 'Android'], ['CrOS', 'ChromeOS'], ['Windows', 'Windows'], ['Mac OS X', 'macOS'], ['Macintosh', 'macOS'], ['Linux', 'Linux']];
const KNOWN_BROWSERS = new Set(BROWSERS.map(([, name]) => name)), KNOWN_SYSTEMS = new Set(SYSTEMS.map(([, name]) => name));
const place = value => typeof value === 'string' && value.length > 0 && value.length <= 60 && /^[\p{L}\p{M} .'’-]+$/u.test(value) ? value : null;
/** Display-only requester context (spike §4.4, N7), derived by the adapter from the request: the browser family and
 * system from a fixed vocabulary (never the raw User-Agent) and the edge's coarse geo (city when reported, region,
 * country), never an IP. Both are approximate and attacker-influenced (R3); they are labels, never authority. */
export function requesterSummary({ userAgent, city, region, country } = {}) {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  const browser = BROWSERS.find(([marker]) => ua.includes(marker))?.[1] ?? null, system = SYSTEMS.find(([marker]) => ua.includes(marker))?.[1] ?? null;
  const location = { ...place(city) ? { city: place(city) } : {}, ...place(region) ? { region: place(region) } : {}, ...typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1' ? { country } : {} };
  return { uaSummary: { browser, system }, approxLocation: Object.keys(location).length ? location : null };
}
/** `j•••@example.com`: the first character of the local part and the domain. */
export const maskAddress = address => { const [local, domain] = String(address).split('@'); return `${local.slice(0, 1)}•••@${domain}`; };
/** The 6-digit code as typed on R: digits with optional spaces. */
export const normalizeCode = value => typeof value === 'string' && value.length <= 16 ? value.replace(/[\s-]/g, '') : '';
const sha256 = async (crypto, value) => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

export class EmailFlow {
  constructor(identity, Fault) { this.identity = identity; this.Fault = Fault; }
  fail(code, message = 'The email sign-in could not be completed.', extra = {}) { throw Object.assign(new this.Fault(code, message), extra); }
  /** H's one generic link failure (EL-7). */
  invalidLink() { this.fail('invalid_link', 'This link has expired or was already used. Ask for a new one on the device you are signing in to.'); }
  /** R's one generic redemption failure (EL-7). */
  invalidFlow() { this.fail('invalid_flow', 'This email sign-in can no longer be completed. Start again.'); }
  enabled() { if (!this.identity.emailFlowEnabled()) this.fail('not_found', 'Email sign-in is not available.', { status: 404 }); }
  get store() { const store = this.identity.emailFlows; if (!store) this.fail('email_unavailable', 'Email delivery is not configured.', { status: 503 }); return store; }
  get limits() { return this.identity.linkedLimits; }
  now() { return this.identity.clock(); }
  mac(purpose, value) { return this.identity.mac(`email-flow-${purpose}`, value); }
  async secretMatches(flow, secret) { const hash = await sha256(this.identity.crypto.crypto, typeof secret === 'string' && B64.test(secret) ? secret : 'invalid'); return Boolean(flow) && typeof secret === 'string' && B64.test(secret) && secureEqual(flow.secretHash, hash); }
  async browserMatches(flow, context) { const value = context?.emailBrowser; if (typeof value !== 'string' || !B64.test(value)) return false; return Boolean(flow) && secureEqual(flow.browserHash, await this.mac('browser', value)); }
  async save(flow, revision) { flow.revision = revision + 1; return this.store.compareAndSwap(flow.flowId, revision, flow); }
  /** Applies `mutate` to the freshest record by CAS (at most 4 tries). `mutate` returns false to abandon. */
  async transition(flowId, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const flow = await this.store.get(flowId); if (!flow) return null;
      const revision = flow.revision, verdict = await mutate(flow); if (verdict === false) return null;
      if (await this.save(flow, revision)) return flow;
    }
    return null;
  }
  /** The mailbox, region and global windows of `email-login` (packages/core/abuse-policy.mjs), keyed by the mailbox
   * pseudonym. */
  mailboxWindow(mailbox, context) { return this.identity.rateLimiter.check({ phase: 'mailbox', operation: 'email-login', remoteIP: context?.remoteIP, region: context?.region, handle: `mailbox\0${mailbox}` }); }
  async network(context, purpose) { const net = linkedNetwork(context?.remoteIP); return net.resolve === 'unknown' ? null : this.mac(purpose, net.resolve); }
  slot() { return Math.floor(this.now() / EMAIL_FLOW_LIMITS.slotMs); }
  /** Live revealed codes: reveals in the current and previous slot (≥ a code's life). Without a counting limiter the cap
   * is assumed, which keeps the global budget at its smallest. */
  async liveCodes() { const limits = this.limits; if (typeof limits?.peek !== 'function') return LIVE_CAP; let total = 0; for (const slot of [this.slot(), this.slot() - 1]) for (let shard = 0; shard < LIVE_SHARDS; shard++) total += await limits.peek(`ef-live:${slot}:${shard}`); return total; }
  /** The flow a link token names: the pointer's flow, only while its index still matches (a resend replaces it). */
  async byLink(token) {
    if (typeof token !== 'string' || !B64.test(token)) return null;
    const index = await this.mac('link', token), flowId = await this.store.findByLink(index); if (!flowId) return null;
    const flow = await this.store.get(flowId);
    return flow && secureEqual(flow.linkIndex, index) ? flow : null;
  }
  linkUsable(flow, states = ['pending', 'code-revealed']) {
    const now = this.now();
    return Boolean(flow) && flow.purpose !== 'inert' && states.includes(flow.state) && flow.linkExpiresAt > now && flow.expiresAt > now;
  }
  async code(flow) {
    const digest = decode(await this.mac('code-derive', `${flow.flowId}|${flow.linkGeneration}|${flow.codeNonce}`));
    return String(new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0) % CODE_SPACE).padStart(6, '0');
  }

  /** Start (R; spike §4.3 step 1, §3.6). Uniform: every branch creates a flow, does the same hashing and writes, and
   * returns `{flowId, expiresIn, interval}`; mail goes out in the background. */
  async start(input, context) {
    const identity = this.identity; this.enabled();
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['email', 'secretHash', 'channelTag', 'turnstileToken', 'locale'].includes(key))) this.fail('invalid_request', 'Enter your email address.');
    if (typeof identity.mailer?.sendEmailFlow !== 'function' || typeof identity.repository.findByEmail !== 'function') this.fail('email_unavailable', 'Email delivery is not configured.', { status: 503 });
    await identity.guard('email', input, context);
    const email = identity.canonicalEmail(input.email);
    if (typeof input.secretHash !== 'string' || !B64.test(input.secretHash) || typeof input.channelTag !== 'string' || !B64.test(input.channelTag) || typeof context?.emailBrowser !== 'string' || !B64.test(context.emailBrowser)) this.fail('invalid_request', 'Reload the page and try again.');
    const locale = input.locale === 'es' ? 'es' : 'en', mailbox = await this.mac('mailbox', email);
    // The mailbox windows (5 per 15 minutes, 12 per 6 hours) are keyed by the keyed pseudonym `mailbox`, which every
    // flow keeps, so a resend charges the very same windows on every branch (P3 security review L1; spike §4.7 "resend
    // counts as a send"). The older bearer link keys them by the address itself; the two never run together (flag).
    if (!await this.mailboxWindow(mailbox, context)) this.fail('rate_limited', 'Please wait before trying again.');
    const browserHash = await this.mac('browser', context.emailBrowser);
    if (!await this.limits.consume(`ef-a:${mailbox}`, EMAIL_FLOW_LIMITS.address) || !await this.limits.consume(`ef-b:${browserHash}`, EMAIL_FLOW_LIMITS.browser)) this.fail('rate_limited', 'Please wait before trying again.');
    // T13 (P3 security review L3): the repositories' `findByEmail` reads a random account key on a miss, so a known and
    // an unknown address both cost one index lookup plus one account read (Node `accounts.mjs`, Worker
    // `identity-shards.mjs`). Residual: CPU and storage latency still differ slightly (record size, the sign-in
    // classification below); the deployed timing gate stays.
    const account = await identity.repository.findByEmail(email), now = this.now();
    const entry = account?.status === 'active' && interactiveIdentity(account) ? signInEmails(account).find(item => item.address === email) : null;
    let purpose = 'inert', notice = null;
    if (entry) purpose = 'sign-in';
    else if (account && !identity.abandonedSignup(account)) notice = account.status === 'active' ? 'verified' : null;
    else if (context?.signupOpen === true && identity.emailSignupEnabled()) purpose = 'sign-up';
    else notice = 'closed';
    const token = identity.crypto.random(32), flowId = identity.crypto.random(16), linkIndex = await this.mac('link', token), net = await this.network(context, 'network');
    const flow = { flowId, revision: 0, purpose, ...purpose === 'sign-in' ? { accountId: account.id, address: email, signInSince: entry.signInSince, securityEpochAtStart: identity.securityEpoch(account) } : purpose === 'sign-up' ? { address: email } : {},
      locale, secretHash: input.secretHash, channelTag: input.channelTag, browserHash, linkIndex, linkGeneration: 1, mailbox,
      requester: { ...requesterShape(context?.requester), createdAt: now, networkPrefixHash: net }, state: 'pending', codeAttempts: 0, reveals: 0, inspects: 0, resends: 0,
      createdAt: now, expiresAt: now + EMAIL_FLOW.flowMs, linkExpiresAt: now + EMAIL_FLOW.linkMs };
    if (!await this.store.create(flow)) this.fail('conflict', 'Please try again.');
    await this.store.putLink(linkIndex, flowId, flow.expiresAt + EMAIL_FLOW.retentionMs);
    if (purpose !== 'inert') identity.background(context, () => identity.mailer.sendEmailFlow({ email, token, purpose, issuer: identity.config.origin, locale }));
    else if (notice) identity.background(context, async () => { if (await this.limits.consume(`ef-n:${mailbox}`, EMAIL_FLOW_LIMITS.notice)) await identity.mailer.sendEmailFlow({ email, purpose: notice === 'verified' ? 'notice-verified' : 'notice-closed', issuer: identity.config.origin, locale }); });
    return { flowId, expiresIn: EMAIL_FLOW.flowMs / 1000, interval: EMAIL_FLOW.interval };
  }

  /** Resend (R): the same flow, a new L (older links dead), a new 10-minute link life; a revealed code is discarded.
   * Same work on every branch; a mailing branch mails in the background. */
  async resend(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    const flow = FLOW_ID.test(input?.flowId ?? '') ? await this.store.get(input.flowId) : null;
    if (!await this.secretMatches(flow, input?.secret) || !['pending', 'code-revealed'].includes(flow.state) || flow.expiresAt <= this.now()) this.invalidFlow();
    // A resend counts as a send (spike §4.7; P3 security review L1): the per-flow cap, the per-mailbox send window and
    // the same mailbox windows as start (5 per 15 minutes, 12 per 6 hours, keyed by the flow's mailbox pseudonym, so
    // inert flows do the same work and charge the same windows). Starts and resends together therefore mail one
    // address at most 12 times in 6 hours, so a resend needs no Turnstile of its own.
    if (flow.resends >= EMAIL_FLOW.resends || !await this.limits.consume(`ef-s:${flow.mailbox}`, EMAIL_FLOW_LIMITS.send) || !await this.mailboxWindow(flow.mailbox, context)) this.fail('rate_limited', 'Please wait before asking for another link.');
    const token = identity.crypto.random(32), linkIndex = await this.mac('link', token);
    const next = await this.transition(flow.flowId, current => {
      if (current.secretHash !== flow.secretHash || !['pending', 'code-revealed'].includes(current.state) || current.expiresAt <= this.now() || current.resends >= EMAIL_FLOW.resends) return false;
      Object.assign(current, { linkIndex, linkGeneration: current.linkGeneration + 1, linkExpiresAt: Math.min(this.now() + EMAIL_FLOW.linkMs, current.expiresAt), resends: current.resends + 1, state: 'pending', codeAttempts: 0, reveals: 0, inspects: 0 });
      delete current.codeHash; delete current.codeNonce; delete current.codeExpiresAt;
    });
    if (!next) this.invalidFlow();
    await this.store.putLink(linkIndex, next.flowId, next.expiresAt + EMAIL_FLOW.retentionMs);
    if (next.purpose !== 'inert') identity.background(context, () => identity.mailer.sendEmailFlow({ email: next.address, token, purpose: next.purpose, issuer: identity.config.origin, locale: next.locale }));
    return { sent: true, expiresIn: Math.max(0, Math.ceil((next.expiresAt - this.now()) / 1000)), interval: EMAIL_FLOW.interval };
  }

  /** Inspect (H; EL-3): read-only except the inspect counter. A live link answers its display context; anything else
   * answers `{invalid:true}`. */
  async inspect(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    const prefix = await this.network(context, 'inspect');
    if (prefix && !await this.limits.consume(`ef-i:${prefix}`, EMAIL_FLOW_LIMITS.inspect)) this.fail('rate_limited', 'Please wait before opening more sign-in links.');
    const flow = await this.byLink(input?.t);
    if (!this.linkUsable(flow) || flow.inspects >= EMAIL_FLOW.inspects) return { invalid: true };
    let account = null;
    if (flow.purpose === 'sign-in') { account = await identity.repository.get(flow.accountId); if (!account || account.status !== 'active') return { invalid: true }; }
    await this.transition(flow.flowId, current => { if (current.linkIndex !== flow.linkIndex) return false; current.inspects += 1; });
    return { purpose: flow.purpose, ...account ? { account: { handle: account.handle } } : { maskedAddress: maskAddress(flow.address) },
      requester: { uaSummary: flow.requester.uaSummary, approxLocation: flow.requester.approxLocation, createdAt: flow.requester.createdAt },
      sameBrowser: await this.browserMatches(flow, context), state: flow.state === 'code-revealed' ? 'code-revealed' : 'pending', expiresAt: Math.min(flow.linkExpiresAt, flow.expiresAt) };
  }

  /** Approve, same browser (H; spike §4.3 step 5): B must match again; the link is used up. Returns the channel tag for
   * the BroadcastChannel wake-up and the flow id it names. */
  async approve(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    if (input?.confirmed !== true) this.fail('confirmation_required', 'Confirm that this is you.');
    const flow = await this.byLink(input?.t);
    if (!this.linkUsable(flow, ['pending']) || !await this.browserMatches(flow, context)) this.invalidLink();
    const next = await this.transition(flow.flowId, current => { if (current.linkIndex !== flow.linkIndex || !this.linkUsable(current, ['pending'])) return false; current.state = 'approved-same-browser'; current.approvedAt = this.now(); });
    if (!next) this.invalidLink();
    return { approved: true, flowId: next.flowId, channelTag: next.channelTag };
  }

  /** Reveal, another device (H; spike §4.3 step 6): the first reveal creates C (5 minutes, capped at the flow's expiry);
   * at most 3 reveals of the same link show the same C. */
  async reveal(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    if (input?.confirmed !== true) this.fail('confirmation_required', 'Confirm that this is you.');
    const flow = await this.byLink(input?.t), now = this.now();
    if (!this.linkUsable(flow) || flow.state === 'code-revealed' && (flow.reveals >= EMAIL_FLOW.reveals || flow.codeExpiresAt <= now)) this.invalidLink();
    let first = false;
    const next = await this.transition(flow.flowId, async current => {
      if (current.linkIndex !== flow.linkIndex || !this.linkUsable(current)) return false;
      if (current.state === 'pending') { first = true; Object.assign(current, { state: 'code-revealed', codeNonce: identity.crypto.random(16), codeExpiresAt: Math.min(this.now() + EMAIL_FLOW.codeMs, current.expiresAt), reveals: 1, revealedAt: this.now() }); current.codeHash = await this.mac('code', `${current.flowId}|${await this.code(current)}`); }
      else { if (current.reveals >= EMAIL_FLOW.reveals || current.codeExpiresAt <= this.now()) return false; current.reveals += 1; }
    });
    if (!next) this.invalidLink();
    if (first) await this.limits.consume(`ef-live:${this.slot()}:${identity.crypto.crypto.getRandomValues(new Uint8Array(1))[0] % LIVE_SHARDS}`, { windowMs: 2 * EMAIL_FLOW_LIMITS.slotMs, limit: Math.ceil(LIVE_CAP / 2 / LIVE_SHARDS) });
    return { code: await this.code(next), expiresAt: next.codeExpiresAt, requester: { uaSummary: next.requester.uaSummary } };
  }

  /** "No, cancel it" (H): ends a live flow; R shows the cancellation. A sign-in flow sends a security notice. */
  async cancelLink(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    if (input?.confirmed !== true) this.fail('confirmation_required', 'Confirm the cancellation.');
    const flow = await this.byLink(input?.t);
    if (!this.linkUsable(flow)) this.invalidLink();
    const next = await this.transition(flow.flowId, current => { if (current.linkIndex !== flow.linkIndex || !this.linkUsable(current)) return false; current.state = 'cancelled'; current.outcome = 'cancelled-link'; current.endedAt = this.now(); });
    if (!next) this.invalidLink();
    if (next.purpose === 'sign-in') identity.background(context, async () => { const account = await identity.repository.get(next.accountId); if (account) await identity.reissueNotice(account, 'email-sign-in-cancelled'); });
    return { cancelled: true };
  }

  /** H after a same-browser approval that R did not acknowledge (spike §4.5): whether R redeemed. Needs B. */
  async linkStatus(input, context) {
    this.enabled(); this.identity.origin(context);
    const flow = await this.byLink(input?.t);
    if (!flow || !['approved-same-browser', 'redeemed'].includes(flow.state) || !await this.browserMatches(flow, context)) return { state: 'gone' };
    if (flow.state === 'redeemed') return { state: 'redeemed' };
    return { state: flow.expiresAt > this.now() ? 'approved' : 'gone' };
  }

  /** Status (R; spike §4.3 step 7). Never writes. A wrong S or unknown flow answers `expired`; polling faster than the
   * interval answers `slow_down`. */
  async status(input, context) {
    this.enabled(); this.identity.origin(context);
    const id = typeof input?.flowId === 'string' && FLOW_ID.test(input.flowId) ? input.flowId : null;
    if (id && !await this.identity.linkedPollLimits.consume(`ef-poll:${id}`, { windowMs: EMAIL_FLOW.interval * 1000 - 500, limit: 1 })) return { status: 'slow_down', interval: EMAIL_FLOW.interval };
    const flow = id ? await this.store.get(id) : null;
    if (!await this.secretMatches(flow, input?.secret)) return { status: 'expired' };
    return { status: this.publicState(flow), interval: EMAIL_FLOW.interval };
  }
  publicState(flow) {
    const now = this.now();
    if (['cancelled', 'locked'].includes(flow.state)) return flow.state;
    if (!live(flow.state) || flow.expiresAt <= now) return 'expired';
    if (flow.state === 'approved-same-browser') return 'approved';
    if (flow.state === 'code-revealed') return flow.codeExpiresAt > now ? 'code' : 'expired';
    return 'pending';
  }

  /** Cancel (R): the user signed in another way, signed out, navigated away or chose Cancel. */
  async cancel(input, context) {
    this.enabled(); this.identity.origin(context);
    const flow = FLOW_ID.test(input?.flowId ?? '') ? await this.store.get(input.flowId) : null;
    if (!await this.secretMatches(flow, input?.secret)) return { cancelled: true };
    await this.transition(flow.flowId, current => { if (!live(current.state)) return false; current.state = 'cancelled'; current.outcome = 'cancelled-requester'; current.endedAt = this.now(); });
    return { cancelled: true };
  }

  /** EL-6 rebinding for a sign-in flow against a freshly read account: still active, the address still a sign-in email
   * with the same `signInSince`, the security epoch unchanged since start. */
  rebinds(flow, account) {
    if (!account || account.id !== flow.accountId || account.status !== 'active' || !interactiveIdentity(account)) return false;
    const entry = signInEmails(account).find(item => item.address === flow.address);
    return Boolean(entry) && entry.signInSince === flow.signInSince && this.identity.securityEpoch(account) === flow.securityEpochAtStart;
  }

  /** Redeem (R; spike §4.3 step 8): S, and C on the code path. Consumes the flow by CAS before anything is minted.
   * Sign-in: EL-6, then a fresh session (`email`, or `email-cross-device` on the code path). Sign-up: a single-use
   * sign-up binding instead of a session (spike §3.4 step 3). */
  async redeem(input, context) {
    const identity = this.identity; this.enabled(); identity.origin(context);
    if (input?.confirmed !== true) this.fail('confirmation_required', 'Confirm to continue.');
    const flow = typeof input?.flowId === 'string' && FLOW_ID.test(input.flowId) ? await this.store.get(input.flowId) : null, now = this.now();
    if (!await this.secretMatches(flow, input?.secret) || flow.expiresAt <= now || !['approved-same-browser', 'code-revealed'].includes(flow.state)) this.invalidFlow();
    if (flow.purpose === 'sign-in') this.accountCap(flow, context);
    let via = 'same-browser';
    if (flow.state === 'code-revealed') {
      via = 'code';
      if (flow.codeExpiresAt <= now) { await this.transition(flow.flowId, current => { if (current.state !== 'code-revealed' || current.codeNonce !== flow.codeNonce) return false; current.state = 'expired'; current.outcome = 'code-expired'; current.endedAt = this.now(); }); this.invalidFlow(); }
      // Every code attempt is reserved before any comparison (P3 security review L2), so parallel guesses cannot exceed a
      // limit: the network prefix's 20 per hour and the global budget are charged first (a correct code spends one unit
      // too), and once the global budget is spent a code redemption needs a fresh Turnstile proof (spike §4.7).
      const prefix = await this.network(context, 'redeem'), budget = { windowMs: EMAIL_FLOW_LIMITS.globalWindowMs, limit: globalRedeemBudget(await this.liveCodes()) };
      if (prefix && !await this.limits.consume(`ef-r:${prefix}`, EMAIL_FLOW_LIMITS.redeemPrefix)) this.fail('rate_limited', 'Too many attempts. Please wait before trying again.', { status: 429 });
      if (!await this.limits.consume('ef-g', budget)) {
        if (typeof input.turnstileToken !== 'string' || input.turnstileToken.length > 4096 || !await identity.turnstile.verify({ token: input.turnstileToken, remoteIP: context.remoteIP, action: 'email', hostname: new URL(identity.config.origin).hostname })) this.fail('challenge_required', 'Complete the security check and enter the code again.', { status: 403 });
      }
      // The flow's own attempt is taken by CAS (at most 5 per revealed code) before the comparison. A reservation that
      // cannot be made (the five are taken, the flow moved on, or the CAS kept losing) evaluates nothing.
      let exhausted = false;
      const reserved = await this.transition(flow.flowId, current => {
        if (current.state !== 'code-revealed' || current.codeNonce !== flow.codeNonce || current.codeExpiresAt <= this.now()) return false;
        if (current.codeAttempts >= EMAIL_FLOW.codeAttempts) { exhausted = true; return false; }
        current.codeAttempts += 1;
      });
      if (!reserved) { if (exhausted) this.fail('flow_locked', 'Too many wrong codes. Start again.', { status: 400 }); this.invalidFlow(); }
      const code = normalizeCode(input.code), matches = /^\d{6}$/.test(code) && secureEqual(reserved.codeHash, await this.mac('code', `${reserved.flowId}|${code}`));
      if (!matches) {
        if (reserved.codeAttempts >= EMAIL_FLOW.codeAttempts) {
          await this.transition(flow.flowId, current => { if (current.state !== 'code-revealed' || current.codeNonce !== flow.codeNonce) return false; current.state = 'locked'; current.outcome = 'locked'; current.endedAt = this.now(); });
          this.fail('flow_locked', 'Too many wrong codes. Start again.', { status: 400 });
        }
        this.fail('invalid_code', 'That code does not match. Check the code on your other device.', { remaining: EMAIL_FLOW.codeAttempts - reserved.codeAttempts });
      }
    }
    if (flow.purpose === 'sign-in') return this.signIn(flow, via, context, { secretHash: flow.secretHash });
    if (flow.purpose === 'sign-up') return this.signupBinding(flow, via, { secretHash: flow.secretHash });
    this.invalidFlow();
  }

  /** Consumes `flow` (from a live, redeemable state) by CAS. `guard` pins fields read before the CAS. */
  async consume(flow, via, guard, extra = () => {}) {
    return this.transition(flow.flowId, async current => {
      if (!['approved-same-browser', 'code-revealed'].includes(current.state) || current.expiresAt <= this.now() || (guard.secretHash && current.secretHash !== guard.secretHash) || current.state !== flow.state || current.codeNonce !== flow.codeNonce) return false;
      Object.assign(current, { state: 'redeemed', outcome: 'redeemed', redeemedVia: via, redeemedAt: this.now() });
      delete current.codeHash; delete current.codeNonce; delete current.channelTag;
      await extra(current);
    });
  }

  /** The multi-account cap (spike T16) before anything is consumed (P3 security review L4). The HTTP adapter passes the
   * accounts this browser already holds as `context.accountMembers` = {owners, limit}; redeeming for an account that is
   * already one of them replaces its session, so only a new account counts. A refusal consumes nothing and sends no
   * notice: the person signs out of an account and redeems the same flow again. The adapter's installation keeps the
   * same check as a backstop for a concurrent sign-in in the same browser (residual: that race still sends the notice
   * of a session that was minted and then revoked). */
  accountCap(flow, context) {
    const members = context?.accountMembers;
    if (!members || !Array.isArray(members.owners) || !Number.isSafeInteger(members.limit)) return;
    if (!members.owners.includes(flow.accountId) && new Set(members.owners).size >= members.limit) this.fail('account_limit', 'Sign out of an account before adding another.', { status: 409 });
  }

  /** `via`: 'same-browser' and 'complete-here' mint an `email` session, 'code' an `email-cross-device` one (N2). The
   * sign-in notice is queued in the same account write that mints the session, after the flow was consumed, and only
   * once the account cap allowed it (L4). */
  async signIn(flow, via, context, guard) {
    const identity = this.identity, source = via === 'code' ? 'email-cross-device' : 'email';
    const first = await identity.repository.get(flow.accountId);
    if (!this.rebinds(flow, first)) { await this.transition(flow.flowId, current => { if (!live(current.state)) return false; current.state = 'expired'; current.outcome = 'rebind-failed'; current.endedAt = this.now(); }); this.invalidFlow(); }
    this.accountCap(flow, context);
    if (!await this.consume(flow, via, guard)) this.invalidFlow();
    for (let attempt = 0, account = first; attempt < 4; attempt++, account = await identity.repository.get(flow.accountId)) {
      if (!this.rebinds(flow, account)) this.invalidFlow();
      const revision = account.revision;
      identity.interactive(account, 'sign-in', context);
      const result = await identity.session(account, { source, emailAddress: flow.address });
      identity.audit(account, source === 'email' ? 'email-sign-in' : 'email-sign-in-cross-device');
      // The notice names the requesting device and coarse place (spike T3; display only, from the fixed vocabulary).
      identity.queueNotice(account, 'email-sign-in', result.sessionContext, { requester: noticeRequester(flow.requester) });
      try { await identity.save(account, revision); } catch (error) { if (error?.code === 'conflict') continue; throw error; }
      return { ...result, source };
    }
    this.invalidFlow();
  }

  async signupBinding(flow, via, guard) {
    const token = this.identity.crypto.random(32);
    const next = await this.consume(flow, via, guard, async current => { current.signupHash = await this.mac('signup', `${current.flowId}|${token}`); current.signupUntil = this.now() + EMAIL_FLOW.signupMs; });
    if (!next) this.invalidFlow();
    return { signup: { signupToken: `es1.${next.flowId}.${token}`, maskedAddress: maskAddress(next.address), expiresAt: next.signupUntil, crossDevice: via === 'code' } };
  }

  /** "The tab that asked for this is closed. Sign in in this tab instead?" (H; spike §4.5, N8): the one path without S.
   * It needs B to match, the flow in `approved-same-browser` and a separate explicit act. The intent held by the closed
   * tab is lost (the console drops any continuation in this tab too). */
  async completeHere(input, context) {
    this.enabled(); this.identity.origin(context);
    if (input?.confirmed !== true) this.fail('confirmation_required', 'Confirm to sign in here.');
    const flow = await this.byLink(input?.t);
    if (!flow || flow.state !== 'approved-same-browser' || flow.expiresAt <= this.now() || !await this.browserMatches(flow, context)) this.invalidLink();
    if (flow.purpose === 'sign-in') return { ...await this.signIn(flow, 'complete-here', context, {}), intentDropped: true };
    if (flow.purpose === 'sign-up') return { ...await this.signupBinding(flow, 'complete-here', {}), intentDropped: true };
    this.invalidLink();
  }

  /** The sign-up binding for `emailSignupConfirm`: the redeemed sign-up flow whose binding is live and unused. */
  async signupFlow(token) {
    const match = typeof token === 'string' ? SIGNUP_TOKEN.exec(token) : null;
    const flow = match ? await this.store.get(match[1]) : null;
    if (!flow || flow.purpose !== 'sign-up' || flow.state !== 'redeemed' || flow.signupUsedAt || !(flow.signupUntil > this.now()) || !secureEqual(flow.signupHash, await this.mac('signup', `${flow.flowId}|${match[2]}`))) this.fail('invalid_flow', 'This sign-up link expired. Start again with your email.');
    return flow;
  }
  /** Marks the binding used by CAS (exactly one confirmation creates an account). */
  async useSignup(flow) {
    const next = await this.transition(flow.flowId, current => { if (current.signupUsedAt || current.signupHash !== flow.signupHash || !(current.signupUntil > this.now())) return false; current.signupUsedAt = this.now(); });
    if (!next) this.fail('invalid_flow', 'This sign-up link expired. Start again with your email.');
    return next;
  }
}
/** The requester summary a sign-in notice carries: browser and system from the fixed vocabulary and the coarse place,
 * or null when nothing is known. */
export const noticeRequester = value => {
  const { uaSummary, approxLocation } = requesterShape(value), browser = KNOWN_BROWSERS.has(uaSummary.browser) ? uaSummary.browser : null, system = KNOWN_SYSTEMS.has(uaSummary.system) ? uaSummary.system : null;
  const location = approxLocation && Object.fromEntries(Object.entries({ city: place(approxLocation.city), region: place(approxLocation.region), country: /^[A-Z]{2}$/.test(approxLocation.country ?? '') ? approxLocation.country : null }).filter(([, v]) => v));
  return browser || system || location && Object.keys(location).length ? { browser, system, location: location && Object.keys(location).length ? location : null } : null;
};
/** One plain-text line for a notice from `noticeRequester` output, or '' (rejects anything outside the vocabulary). */
export function requesterLine(requester) {
  if (!requester || typeof requester !== 'object') return '';
  const browser = KNOWN_BROWSERS.has(requester.browser) ? requester.browser : null, system = KNOWN_SYSTEMS.has(requester.system) ? requester.system : null, at = requester.location && typeof requester.location === 'object' ? requester.location : {};
  const where = [place(at.city), place(at.region), /^[A-Z]{2}$/.test(at.country ?? '') ? at.country : null].filter(Boolean).join(', ');
  const device = browser && system ? `${browser} on ${system}` : browser ?? system;
  if (!device && !where) return '';
  return `Requested from ${[device, where && `near ${where}`].filter(Boolean).join(', ')} (approximate; a VPN can change the place).`;
}
const requesterShape = value => {
  const ua = value?.uaSummary ?? {}, location = value?.approxLocation;
  return { uaSummary: { browser: typeof ua.browser === 'string' ? ua.browser : null, system: typeof ua.system === 'string' ? ua.system : null }, approxLocation: location && typeof location === 'object' ? { ...typeof location.city === 'string' ? { city: location.city } : {}, ...typeof location.region === 'string' ? { region: location.region } : {}, ...typeof location.country === 'string' ? { country: location.country } : {} } : null };
};
