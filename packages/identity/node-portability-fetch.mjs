// Node egress for the portability client (packages/identity/successors.mjs `portabilityClient`), used by transfer-in,
// successor adoption and redirect management on the Node adapter. Derived from the reviewed DNS-pinned pattern of
// packages/apps/node-metadata-fetch.mjs and packages/federation/node-integration-egress.mjs:
//   - URL policy: `portabilityURL` (canonical HTTPS on the default port, a public DNS host, no userinfo or fragment);
//     a query is allowed (directory `?sub=` lookups); IP literals and special-use names are refused;
//   - DNS: A records only; EVERY answer must be globally routable IPv4 (publicAddress), else nothing is dialled; IPv6 is
//     unavailable until a reviewed global-address classifier exists, so an AAAA-only host fails closed;
//   - the selected address is pinned into the HTTPS connection (`lookup` returns only it) with original-hostname TLS
//     verification (servername, rejectUnauthorized, no shared agent), so a DNS rebind between screen and connect is moot;
//   - GET or POST only; a POST body is at most `maxRequestBytes`; `Accept-Encoding: identity` and any other response
//     encoding is refused; the response body is bounded by `maxBytes`; deadline and abort signal; a concurrency cap;
//   - redirects are NEVER followed: a 3xx is returned as data (status, Location and a bounded body), as the client's
//     `redirect: 'manual'` contract expects (spec §10: redirects are hints). 429/5xx are returned with Retry-After.
// Budgets (per site and global) live in the portability client and are consumed before this port is called.
import { lookup as nodeLookup } from 'node:dns/promises';
import { request as nodeRequest } from 'node:https';
import { isIP } from 'node:net';
import { portabilityURL, PORTABILITY_LIMITS } from './successors.mjs';
import { publicAddress } from '../apps/form-fetch-policy.mjs';

export const NODE_PORTABILITY_LIMITS = Object.freeze({ timeoutMs: PORTABILITY_LIMITS.timeoutMs, maxBytes: 160 * 1024, maxRequestBytes: 16384, maxConcurrent: 16 });
const PASSED = ['content-type', 'content-length', 'content-encoding', 'location', 'retry-after', 'cache-control'];
const refuse = message => Object.assign(new Error(message ?? 'The identity provider could not be reached safely.'), { code: 'egress_refused' });
const bounded = (value, max, label) => { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`Invalid portability egress ${label}.`); return value; };

const REQUEST_TYPES = ['application/json', 'application/x-www-form-urlencoded'];
export function createNodePortabilityFetch({ lookup = nodeLookup, request = nodeRequest, timeoutMs = NODE_PORTABILITY_LIMITS.timeoutMs, maxBytes = NODE_PORTABILITY_LIMITS.maxBytes, maxRequestBytes = NODE_PORTABILITY_LIMITS.maxRequestBytes, maxConcurrent = NODE_PORTABILITY_LIMITS.maxConcurrent } = {}) {
  bounded(timeoutMs, 10000, 'timeout'); bounded(maxBytes, 1048576, 'body limit'); bounded(maxRequestBytes, 65536, 'request limit'); bounded(maxConcurrent, 64, 'concurrency');
  if (typeof lookup !== 'function' || typeof request !== 'function') throw new TypeError('Portability egress needs a DNS lookup and an HTTPS request function.');
  let active = 0;
  return async function nodePortabilityFetch(value, init = {}) {
    const url = portabilityURL(value);
    if (!url || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw refuse();
    const method = init.method === undefined ? 'GET' : init.method;
    if (!['GET', 'POST'].includes(method)) throw refuse('Portability egress permits GET and POST only.');
    let payload = null;
    if (method === 'POST') { if (typeof init.body !== 'string') throw refuse('A portability POST needs a string body.'); payload = Buffer.from(init.body, 'utf8'); if (payload.length > maxRequestBytes) throw refuse('The portability request is too large.'); }
    else if (init.body !== undefined && init.body !== null) throw refuse('A portability GET has no body.');
    const given = new Headers(init.headers ?? {}), headers = { Host: url.host, Accept: given.get('Accept') ?? 'application/json', 'Accept-Encoding': 'identity' };
    // Review L1: an allowlisted request Content-Type passes through (the SDK's token and revocation requests are
    // form-encoded); anything else, or none, is sent as JSON.
    const type = (given.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (payload) Object.assign(headers, { 'Content-Type': REQUEST_TYPES.includes(type) ? type : 'application/json', 'Content-Length': String(payload.length) });
    if (init.signal?.aborted) throw refuse('The portability request was aborted.');
    if (active >= maxConcurrent) throw Object.assign(new Error('The identity provider egress is busy.'), { code: 'egress_busy' });
    active++;
    try {
      return await new Promise((resolve, reject) => {
        let req, res, done = false;
        const abort = () => finish(refuse('The portability request was aborted.'));
        const timer = setTimeout(() => finish(refuse('The portability request timed out.')), timeoutMs);
        function finish(error, response) { if (done) return; done = true; clearTimeout(timer); init.signal?.removeEventListener('abort', abort); if (error) { res?.destroy(); req?.destroy(); reject(error); } else resolve(response); }
        init.signal?.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => lookup(url.hostname, { all: true, family: 4, verbatim: true })).then(records => {
          if (done) return;
          if (!Array.isArray(records) || !records.length || records.length > 64 || records.some(r => r?.family !== 4 || typeof r.address !== 'string' || isIP(r.address) !== 4 || !publicAddress(r.address))) throw refuse('Identity provider DNS must contain only globally routable IPv4 addresses.');
          const selected = records[0].address;
          const pinned = (_host, opts, callback) => { if (typeof opts === 'function') { callback = opts; opts = {}; } if (opts?.all) callback(null, [{ address: selected, family: 4 }]); else callback(null, selected, 4); };
          req = request({ protocol: 'https:', hostname: url.hostname, port: 443, path: url.pathname + url.search, method, servername: url.hostname, lookup: pinned, agent: false, rejectUnauthorized: true, maxHeaderSize: 16384, headers }, incoming => {
            res = incoming; if (done) { res.destroy(); return; }
            const status = res.statusCode, length = res.headers['content-length'], encoding = res.headers['content-encoding'];
            if (!Number.isInteger(status) || status < 200 || status > 599) { finish(refuse()); return; }
            if (encoding && String(encoding).toLowerCase() !== 'identity' || length !== undefined && (typeof length !== 'string' || !/^\d{1,9}$/.test(length) || Number(length) > maxBytes)) { finish(refuse('The identity provider response was rejected.')); return; }
            let size = 0; const chunks = [];
            res.on('data', chunk => { if (done) return; size += chunk.length; if (size > maxBytes) { finish(refuse('The identity provider response exceeds limits.')); return; } chunks.push(Buffer.from(chunk)); });
            res.once('error', () => finish(refuse())); res.once('aborted', () => finish(refuse()));
            res.once('end', () => {
              if (done) return;
              try {
                const out = new Headers(); for (const name of PASSED) if (typeof res.headers[name] === 'string') out.set(name, res.headers[name]);
                // 1xx/204/304-style null bodies cannot carry a body in a Response; 3xx with a body is kept (308 moved body).
                const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks, size);
                finish(null, new Response(body, { status, headers: out }));
              } catch { finish(refuse()); }
            });
          });
          req.once('error', () => finish(refuse()));
          req.end(payload ?? undefined);
        }).catch(error => finish(error?.code === 'egress_refused' ? error : refuse()));
      });
    } finally { active--; }
  };
}
