import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNodePortabilityFetch } from '../packages/identity/node-portability-fetch.mjs';
import { portabilityClient } from '../packages/identity/successors.mjs';
import { EXT } from '../packages/core/extensions.mjs';

const SUB = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
/** A fake https.request: records options and written bytes, answers with `reply` ({status, headers, chunks, hang}). */
function fakeRequest(reply = {}) {
  const calls = [];
  const request = (options, onResponse) => {
    const req = new EventEmitter(), call = { options, written: null, destroyed: false }; calls.push(call);
    req.destroy = () => { call.destroyed = true; };
    req.end = body => {
      call.written = body === undefined ? null : Buffer.from(body);
      if (reply.hang) return;
      if (reply.error) { queueMicrotask(() => req.emit('error', new Error('socket'))); return; }
      // The pinned lookup is what the socket would use: resolve through it, as node:net does.
      options.lookup(options.hostname, { all: false }, (_e, address) => { call.dialled = address; });
      const res = new EventEmitter(); res.statusCode = reply.status ?? 200; res.headers = reply.headers ?? { 'content-type': 'application/json' }; res.destroy = () => { call.resDestroyed = true; };
      queueMicrotask(() => { onResponse(res); for (const chunk of reply.chunks ?? ['{}']) res.emit('data', Buffer.from(chunk)); res.emit('end'); });
    };
    return req;
  };
  return { request, calls };
}
const lookupOf = records => { const seen = []; const lookup = async (host, opts) => { seen.push({ host, opts }); return records; }; lookup.seen = seen; return lookup; };
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

test('refuses non-public DNS answers before any connection', async () => {
  for (const records of [[{ address: '10.0.0.1', family: 4 }], [{ address: '127.0.0.1', family: 4 }], [{ address: '100.64.1.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }], [{ address: '192.168.1.1', family: 4 }], [{ address: '::1', family: 6 }], [{ address: '2606:4700::1', family: 6 }], [...PUBLIC, { address: '10.1.1.1', family: 4 }], [], null]) {
    const { request, calls } = fakeRequest();
    const fetch = createNodePortabilityFetch({ lookup: lookupOf(records), request });
    await assert.rejects(fetch('https://provider.example.com/.well-known/bindle/manifest.json'), { code: 'egress_refused' });
    assert.equal(calls.length, 0, JSON.stringify(records));
  }
});

test('pins the screened address with original-host TLS, A records only', async () => {
  const { request, calls } = fakeRequest({ chunks: ['{"ok":true}'] }), lookup = lookupOf([{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }]);
  const fetch = createNodePortabilityFetch({ lookup, request });
  const response = await fetch(`https://dir.provider.example.com/directory?sub=${SUB}`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(lookup.seen[0].opts, { all: true, family: 4, verbatim: true });
  const o = calls[0].options;
  assert.equal(o.hostname, 'dir.provider.example.com'); assert.equal(o.servername, 'dir.provider.example.com'); assert.equal(o.rejectUnauthorized, true); assert.equal(o.agent, false); assert.equal(o.port, 443);
  assert.equal(o.path, `/directory?sub=${SUB}`); assert.equal(o.headers.Host, 'dir.provider.example.com'); assert.equal(o.headers['Accept-Encoding'], 'identity');
  assert.equal(calls[0].dialled, '93.184.216.34');
  o.lookup('elsewhere.example', { all: true }, (_e, all) => assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]));
});

test('a 308 is returned as data with Location and its bounded body; nothing is followed', async () => {
  const body = JSON.stringify({ v: 1, iss: 'https://old.example.com', sub: SUB, moved: { statement: 's', attestation: 'a' } });
  const { request, calls } = fakeRequest({ status: 308, headers: { 'content-type': 'application/json', location: 'https://new.example.com/x/', 'cache-control': 'private, max-age=60' }, chunks: [body] });
  const fetch = createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request });
  const response = await fetch(`https://old.example.com/identity/${SUB}/identity.json`);
  assert.equal(response.status, 308); assert.equal(response.headers.get('Location'), 'https://new.example.com/x/'); assert.equal(await response.text(), body);
  assert.equal(calls.length, 1);
});

test('429/5xx pass through with Retry-After', async () => {
  const { request } = fakeRequest({ status: 503, headers: { 'retry-after': '120', 'content-type': 'text/plain' }, chunks: ['busy'] });
  const response = await createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request })('https://p.example.com/x');
  assert.equal(response.status, 503); assert.equal(response.headers.get('Retry-After'), '120');
});

test('POST sends the JSON body with Content-Length and caps its size', async () => {
  const { request, calls } = fakeRequest({ chunks: ['{"status":"refused"}'], status: 409 });
  const fetch = createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request });
  const text = JSON.stringify({ v: 1, statement: 'x', transfer: null, redirect_base: 'https://b.example.com/r/' });
  const response = await fetch('https://p.example.com/bindle/portability/move', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } });
  assert.equal(response.status, 409);
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers['Content-Length'], String(Buffer.byteLength(text))); assert.equal(calls[0].written.toString(), text);
  await assert.rejects(fetch('https://p.example.com/m', { method: 'POST', body: 'x'.repeat(16385) }), { code: 'egress_refused' });
  await assert.rejects(fetch('https://p.example.com/m', { method: 'PUT', body: '{}' }), { code: 'egress_refused' });
  await assert.rejects(fetch('https://p.example.com/m', { method: 'GET', body: '{}' }), { code: 'egress_refused' });
  assert.equal(calls.length, 1);
});

test('oversized and encoded responses are refused', async () => {
  for (const reply of [{ headers: { 'content-length': '999999999' } }, { chunks: ['x'.repeat(600), 'y'.repeat(600)] }, { headers: { 'content-encoding': 'gzip' } }, { status: 101 }]) {
    const { request } = fakeRequest(reply);
    await assert.rejects(createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request, maxBytes: 1000 })('https://p.example.com/x'), { code: 'egress_refused' });
  }
});

test('timeout, abort and the concurrency cap', async () => {
  const hang = fakeRequest({ hang: true });
  await assert.rejects(createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request: hang.request, timeoutMs: 20 })('https://p.example.com/x'), /timed out/);
  assert.equal(hang.calls[0].destroyed, true);
  const controller = new AbortController(), slow = fakeRequest({ hang: true }), fetch = createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request: slow.request, timeoutMs: 1000, maxConcurrent: 1 });
  const first = fetch('https://p.example.com/x', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(fetch('https://p.example.com/y'), { code: 'egress_busy' });
  controller.abort(); await assert.rejects(first, /aborted/);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(fetch('https://p.example.com/z', { signal: pre.signal }), /aborted/);
});

test('URL policy refusals dial nothing', async () => {
  const { request, calls } = fakeRequest(), lookup = lookupOf(PUBLIC), fetch = createNodePortabilityFetch({ lookup, request });
  for (const url of ['http://p.example.com/x', 'https://p.example.com:8443/x', 'https://u:p@p.example.com/x', 'https://93.184.216.34/x', 'https://[2606:4700::1]/x', 'https://localhost/x', 'https://svc.internal/x', 'https://p.example.com/x#f', 'https://P.example.com/x', 'ftp://p.example.com/x'])
    await assert.rejects(fetch(url), { code: 'egress_refused' }, url);
  assert.equal(lookup.seen.length, 0); assert.equal(calls.length, 0);
});

test('works as the portability client egress (manifest, 308 lookup, move POST)', async () => {
  const replies = {
    'https://src.example.com/.well-known/bindle/manifest.json': { chunks: [JSON.stringify({ version: '0', issuer: 'https://src.example.com', extensions: [{ spec: EXT.directory, options: { directory_url: 'https://src.example.com/bindle/directory' } }, { spec: EXT.portability, options: { move_endpoint: 'https://src.example.com/bindle/portability/move', attestation_jwks_uri: 'https://src.example.com/bindle/portability/attestation-keys' } }] })] },
    [`https://src.example.com/bindle/directory?sub=${SUB}`]: { status: 308, headers: { 'content-type': 'application/json', location: 'https://dst.example.com/r/bindle/directory?sub=x' }, chunks: [JSON.stringify({ v: 1, iss: 'https://src.example.com', sub: SUB, moved: { statement: 'S', attestation: 'A' } })] },
    'https://src.example.com/bindle/portability/move': { status: 202, chunks: [JSON.stringify({ status: 'pending', authorize_url: 'https://src.example.com/account/transfer-out', retry_after: 60 })] },
  };
  const request = (options, onResponse) => { const url = `https://${options.hostname}${options.path}`; return fakeRequest(replies[url] ?? { status: 404 }).request(options, onResponse); };
  const client = portabilityClient({ fetch: createNodePortabilityFetch({ lookup: lookupOf(PUBLIC), request }) });
  assert.deepEqual(await client.lookup('https://src.example.com', SUB), { status: 'moved', location: 'https://dst.example.com/r/bindle/directory?sub=x', record: { statement: 'S', attestation: 'A' } });
  assert.equal((await client.move('https://src.example.com', { v: 1 })).status, 'pending');
});

test('the Node server wires transfer-in with the pinned portability egress', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { createNodeServer } = await import('../apps/node/server.mjs');
  const origin = 'http://localhost:8788', post = (app, path, value) => app.fetch(new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) }));
  const dialled = [];
  const directory = await mkdtemp(join(tmpdir(), 'bindle-node-portability-')); let app;
  try {
    app = await createNodeServer({ directory, config: { PORTABILITY_DNS_LOOKUP: async () => [{ address: '10.0.0.5', family: 4 }], PORTABILITY_HTTPS_REQUEST: () => { dialled.push(true); throw new Error('dialled'); } } });
    const ports = app.resources.transferInPorts;
    assert.equal(typeof ports.fetch, 'function'); assert.equal(typeof ports.identity?.get, 'function'); assert.ok(ports.recovery);
    // The injected DNS answer is private: refused before any socket.
    await assert.rejects(ports.fetch('https://provider.example.com/.well-known/bindle/manifest.json'), { code: 'egress_refused' });
    // TRANSFER_IN_INTAKE is mounted (status is not flag-gated; an unwired adapter answers 404).
    assert.notEqual((await post(app, '/api/transfer-in/status', {})).status, 404);
    // New intake stays behind the flag (off by default).
    assert.equal((await post(app, '/api/transfer-in/check', { package: { bindle: 'identity-package' } })).status, 404);
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
  assert.equal(dialled.length, 0);
});
