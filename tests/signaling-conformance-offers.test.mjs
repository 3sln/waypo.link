// Clean-room signaling conformance (signaling.v1 rev 3.2, Appendix C.5 step 6), §21.2 "New, needed by this draft": offers
// (uses, bound and open offers, revocation, dead offers, windows, sub-budget, blocks), the data profile and transport
// (same-host iss refusal, per-entity enablement).
// Shared world, conventions and seams: tests/helpers/signaling-conformance-world.mjs. Divergences are t.todo in normal
// mode and fail under SIGNALING_CONFORMANCE_STRICT=1 unless marked plausibly intentional.
import assert from 'node:assert/strict';
import {DATA_LINE, KIND, LINE, PEER, PROVIDER, REF, SIGNALING_EXT, accept, appMessage, auth, beacon, boot, callee, cancel, checks, declares, decline, deliver, delivered, diverge, endpoint, errorCode, ext, invite, listener, peerSaw, peerSend, sentinel, sleep, test, useWorld, w} from './helpers/signaling-conformance-world.mjs';
import {keyPair, newSid, now, offerDigest, malleate, candidate, candidateItem, randomId, dataBody, DATA_LIMITS} from './signaling-conformance-peer.mjs';

useWorld();
// ==== §5.7 offers ====================================================================================================
test('§5.2/§5.7 open-offer uses: reserved at admission, released by a decline or an unclaimed end, spent only by an accept; spent plus reserved never exceed uses', async t => {
  const ctx = await callee(); await beacon(ctx);
  const token = (await ctx.mint({uses: 1})).offers[0].offer, {wrong, expect} = checks();
  const st = async () => { await sleep(300); const s = await ctx.offerState(token); return s && {spent: s.spent, reserved: s.reserved, uses: s.uses}; };
  const fresh = await st(); t.diagnostic(`fresh: ${JSON.stringify(fresh)}`);
  expect(fresh && fresh.uses === 1 && fresh.spent === 0 && fresh.reserved === 0, `owner list of a fresh uses:1 offer: ${JSON.stringify(fresh)}`);
  const d1 = await invite(ctx, {token}); assert.ok(await deliver(ctx, d1), 'first dial-back admitted');
  expect(JSON.stringify(await st()) === JSON.stringify({spent: 0, reserved: 1, uses: 1}), `after admission: ${JSON.stringify(await st())}`);
  const d2 = await invite(ctx, {token}); await w.peer.post(d2.batch);
  expect(!await delivered(ctx, d2.sid), 'a second dial-back admitted while the only use was reserved');
  await decline(ctx, d1);
  expect(JSON.stringify(await st()) === JSON.stringify({spent: 0, reserved: 0, uses: 1}), `after a decline: ${JSON.stringify(await st())}`);
  const d3 = await invite(ctx, {token}), e3 = await deliver(ctx, d3);
  expect(e3, 'a dial-back after the decline released the use');
  if (e3) {
    await cancel(ctx, d3);
    await ctx.waitEvent(e => e.sid === d3.sid && e.type === 'state', 4000);
    expect(JSON.stringify(await st()) === JSON.stringify({spent: 0, reserved: 0, uses: 1}), `after an unclaimed end (cancel): ${JSON.stringify(await st())}`);
  }
  const d4 = await invite(ctx, {token}), e4 = await deliver(ctx, d4);
  expect(e4, 'a dial-back after the unclaimed end released the use');
  if (e4) { await accept(ctx, d4); expect(JSON.stringify(await st()) === JSON.stringify({spent: 1, reserved: 0, uses: 1}), `after an accept: ${JSON.stringify(await st())}`); }
  const d5 = await invite(ctx, {token}); await w.peer.post(d5.batch);
  expect(!await delivered(ctx, d5.sid), 'a dial-back admitted after the only use was spent');
  if (wrong.length) diverge(t, {section: '§5.2 ("Open offer. One use is reserved at admission. It is spent only by an accept claim ... and released if the session is declined or ends unclaimed"), §10.2 claim, §14.1 (uses spent of uses)', request: 'dial-backs on a uses:1 open offer around a decline, a cancel and an accept', observed: wrong.join('; '), expected: 'reserve 1, release on decline and on unclaimed end, spend on accept; no admission without a free use', side: 'implementation'});
});

test('§5.2/§5.7/§10.2 bound offers: single use spent at admission whatever the outcome; uses other than 1, the owner\'s own principal and more than 16 principals are refused', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {wrong, expect} = checks(), base = {...ctx.ep, kind: LINE, profile: 'webrtc', expires_in: 900};
  const peers = await Promise.all(Array.from({length: 17}, () => w.peer.entity()));
  const refusals = {
    'principals with uses 2': await ctx.c.call('offer', {...base, principals: [ctx.bob.principal], uses: 2}),
    'the owner\'s own principal': await ctx.c.call('offer', {...base, principals: [ctx.acct.principal]}),
    '17 principals': await ctx.c.call('offer', {...base, principals: peers.map(p => p.principal)}),
    'a principal listed twice': await ctx.c.call('offer', {...base, principals: [ctx.bob.principal, ctx.bob.principal]})
  };
  for (const [name, r] of Object.entries(refusals)) { t.diagnostic(`${name} -> ${JSON.stringify(r.error ?? r.result)}`); expect(errorCode(r) === 'invalid_args', `${name}: ${r.result ? 'minted' : errorCode(r)}`); }
  const sixteen = await ctx.c.call('offer', {...base, principals: peers.slice(0, 16).map(p => p.principal)});
  expect(sixteen.result?.offers?.length === 16, `16 principals: ${JSON.stringify(sixteen.error ?? sixteen.result?.offers?.length)}`);
  for (const outcome of ['decline', 'cancel']) {
    const token = (await ctx.mint({principals: [ctx.bob.principal]})).offers[0].offer;
    const first = await invite(ctx, {token}); assert.ok(await deliver(ctx, first), `bound offer admitted once (${outcome})`);
    await sleep(300); const s = await ctx.offerState(token);
    expect(!s || s.spent === 1, `${outcome}: the single use is spent at admission (owner list ${JSON.stringify(s && {spent: s.spent, reserved: s.reserved})})`);
    if (outcome === 'decline') await decline(ctx, first); else await cancel(ctx, first);
    await sleep(300);
    const second = await invite(ctx, {token}); await w.peer.post(second.batch);
    expect(!await delivered(ctx, second.sid), `a second dial-back after a ${outcome} was admitted`);
  }
  if (wrong.length) diverge(t, {section: '§5.2 ("Bound offer (single-shot). The single use is spent at admission"), §5.7 Minting, §10.2 offer', request: 'offer argument refusals and second dial-backs on a bound offer after a decline and after a cancel', observed: wrong.join('; '), expected: 'refused with invalid_args; a bound offer admits exactly one session', side: 'implementation'});
});

test('§5.7/§4.3 expiry bounds for an endpoint that is not service-class, and a person entity cannot be designated a service entity', async t => {
  const ctx = await callee(), {wrong, expect} = checks(), base = {...ctx.ep, kind: LINE, profile: 'webrtc'};
  const cases = [['open offer expires_in 901', {expires_in: 901}, false], ['open offer expires_in 9', {expires_in: 9}, false], ['open offer expires_in 10', {expires_in: 10}, true], ['open offer expires_in 900', {expires_in: 900}, true], ['bound offer expires_in 604800', {expires_in: 604800, principals: [ctx.bob.principal]}, false], ['open offer uses 17 (reference maximum 16 for an endpoint that is not service-class)', {expires_in: 60, uses: 17}, false]];
  for (const [name, args, ok] of cases) { const r = await ctx.c.call('offer', {...base, ...args}); t.diagnostic(`${name} -> ${JSON.stringify(r.error ?? {offers: r.result?.offers?.length, expires_at: r.result?.expires_at})}`); expect(ok ? !!r.result?.offers?.length : errorCode(r) === 'invalid_args', `${name}: ${r.result ? 'minted' : errorCode(r)}`); }
  const [designate] = await w.widen(ctx.acct, [{action: 'set-service', input: {designated: true, revision: 0}}]);
  t.diagnostic(`person entity set-service -> ${designate.status}`);
  expect(designate.status !== 200, 'a person entity was designated a service entity');
  const strict = wrong.filter(x => !x.startsWith('open offer uses 17')), policy = wrong.filter(x => x.startsWith('open offer uses 17'));
  if (strict.length) diverge(t, {section: '§5.7 ("expires_in is from 10 to 900 seconds"; service-class maxima), §4.3 ("A person entity cannot be designated")', request: 'offer expiry bounds from a person app; set-service on a person entity', observed: strict.join('; '), expected: 'outside 10-900 s refused with invalid_args; designation refused', side: 'implementation'});
  if (policy.length) diverge(t, {section: '§5.7 (uses "to a provider maximum (reference: 16 for an endpoint that is not service-class)")', request: 'uses 17 from a person app', observed: policy.join('; '), expected: 'refused at the reference maximum', side: 'implementation', intentional: true});
});

test('§5.7/§8.5/§13.4 revoke_offer, owner revocation and expiry each end the pending sessions the offer admitted silently; a claimed session is unaffected; a revoked offer admits nothing', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {wrong, expect} = checks(), quiet = [];
  const expiring = (await ctx.mint({uses: 4, expires_in: 10})).offers[0].offer, expiringInv = await invite(ctx, {token: expiring});
  assert.ok(await deliver(ctx, expiringInv), 'admitted on the short-lived offer');
  // revoke_offer by token
  const a = (await ctx.mint({uses: 4})).offers[0].offer, ai = await invite(ctx, {token: a}); assert.ok(await deliver(ctx, ai));
  const rv = await ctx.c.call('revoke_offer', {...ctx.ep, offers: [a]}); expect(rv.status === 200 && rv.result, `revoke_offer: ${JSON.stringify(rv.error ?? rv.result)}`);
  expect(await ctx.waitEvent(e => e.sid === ai.sid && e.type === 'state' && e.state === 'ended', 4000), 'revoke_offer: the pending session it admitted ended at the endpoint');
  quiet.push(ai.sid);
  const aAgain = await invite(ctx, {token: a}); await w.peer.post(aAgain.batch);
  expect(!await delivered(ctx, aAgain.sid), 'a revoked offer admitted a dial-back');
  // owner revocation by id (the stored digest; §14.1 "never the token")
  const b = (await ctx.mint({uses: 4})).offers[0].offer, bi = await invite(ctx, {token: b}); assert.ok(await deliver(ctx, bi));
  const ow = await ctx.owner('revoke-offers', {id: await offerDigest(b)}); expect(ow.status === 200, `owner revoke-offers -> ${ow.status}`);
  expect(await ctx.waitEvent(e => e.sid === bi.sid && e.type === 'state' && e.state === 'ended', 4000), 'owner revocation: the pending session it admitted ended at the endpoint');
  quiet.push(bi.sid);
  // a claimed session is unaffected by its offer's end
  const c = (await ctx.mint({uses: 4})).offers[0].offer, ci = await invite(ctx, {token: c}); assert.ok(await deliver(ctx, ci)); const cs = await accept(ctx, ci);
  await ctx.c.call('revoke_offer', {...ctx.ep, offers: [c]});
  expect((await peerSend(ctx, cs, 'candidates', {gen: 0, items: [candidateItem(candidate())], complete: false})).got, 'a claimed session stopped relaying after its offer was revoked');
  // revoke_offer without a list revokes every live offer this endpoint minted
  const d = (await ctx.mint({uses: 4})).offers[0].offer; ctx.current = null;
  await ctx.c.call('revoke_offer', {...ctx.ep});
  const dAgain = await invite(ctx, {token: d}); await w.peer.post(dAgain.batch);
  expect(!await delivered(ctx, dAgain.sid), 'revoke_offer without offers left an offer of this endpoint live');
  // expiry
  const ended = await ctx.waitEvent(e => e.sid === expiringInv.sid && e.type === 'state' && e.state === 'ended', 15000);
  expect(ended, 'expiry: the pending session the expired offer admitted ended at the endpoint');
  quiet.push(expiringInv.sid);
  await sleep(1000);
  const leaked = peerSaw(quiet);
  expect(!leaked.length, `the initiator provider received ${leaked.map(m => `${m.payload.type}/${m.payload.reason ?? ''}`).join(', ')}`);
  if (wrong.length) diverge(t, {section: '§5.7 ("Ending what an offer admitted ... ends silently"; Revoking), §8.5, §13.4, §14.1', request: 'revoke_offer (listed and all), owner revoke-offers and expiry while sessions are pending; revoke after a claim', observed: wrong.join('; '), expected: 'pending sessions end silently, claimed ones continue, revoked offers admit nothing', side: 'implementation'});
}, {timeout: 120000});

test('§5.2/§12.1 dead offers (unknown, expired, revoked, exhausted, wrong principal, another kind line, another profile) admit nothing with an identical 202 and timing class', async t => {
  const ctx = await callee({kinds: [LINE, DATA_LINE]}); await beacon(ctx);
  const {wrong, expect} = checks(), started = Date.now();
  const expired = (await ctx.mint({expires_in: 10, uses: 4})).offers[0].offer;
  const revoked = (await ctx.mint({uses: 4})).offers[0].offer; await ctx.c.call('revoke_offer', {...ctx.ep, offers: [revoked]});
  const exhausted = (await ctx.mint({principals: [ctx.bob.principal]})).offers[0].offer;
  const used = await invite(ctx, {token: exhausted}); assert.ok(await deliver(ctx, used), 'bound offer used once'); await decline(ctx, used);
  const elsewhere = await w.peers.floor.entity(), wrongPrincipal = (await ctx.mint({principals: [elsewhere.principal]})).offers[0].offer;
  const dataOffer = (await ctx.mint({kind: DATA_LINE, profile: 'data', uses: 8})).offers[0].offer;
  await sleep(Math.max(0, 11000 - (Date.now() - started)));
  const cases = {
    'unknown digest': () => invite(ctx, {token: randomId(32)}),
    'expired offer': () => invite(ctx, {token: expired}),
    'revoked offer': () => invite(ctx, {token: revoked}),
    'exhausted bound offer': () => invite(ctx, {token: exhausted}),
    'bound to another principal': () => invite(ctx, {token: wrongPrincipal}),
    'another kind line': () => invite(ctx, {token: dataOffer}),
    'another profile': () => invite(ctx, {token: dataOffer, kind: REF[DATA_LINE], profile: 'webrtc'})
  };
  const seen = {}, sids = [];
  for (const [name, make] of Object.entries(cases)) {
    seen[name] = [];
    for (let i = 0; i < 3; i++) { const inv = await make(); sids.push([name, inv.sid]); const t0 = performance.now(); const r = await w.peer.post(inv.batch); seen[name].push({ms: performance.now() - t0, status: r.status, body: r.body, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), length: r.headers.get('content-length')}); }
  }
  const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1], base = seen['unknown digest'][0];
  for (const [name, rows] of Object.entries(seen)) {
    for (const r of rows) expect(r.status === 202 && r.body === '' && r.type === base.type && r.cache === base.cache && r.length === base.length, `${name}: ${JSON.stringify({status: r.status, body: r.body, type: r.type, cache: r.cache})}`);
    const m = median(rows.map(r => r.ms)), b = median(seen['unknown digest'].map(r => r.ms));
    t.diagnostic(`${name}: median ${m.toFixed(1)} ms (unknown digest ${b.toFixed(1)} ms)`);
    expect(Math.abs(m - b) < 60, `${name}: median response ${m.toFixed(1)} ms against ${b.toFixed(1)} ms for an unknown digest`);
  }
  await sentinel(ctx);
  const through = sids.filter(([, sid]) => ctx.has(e => e.type === 'invite' && e.sid === sid)).map(([name]) => name);
  expect(!through.length, `admitted: ${[...new Set(through)].join(', ')}`);
  // Control: the live data offer still admits a matching dial-back (dead-offer invites did not lock it).
  expect(await deliver(ctx, await invite(ctx, {token: dataOffer, kind: REF[DATA_LINE], profile: 'data'})), 'the live open offer admitted its own kind line and profile after the dead-offer invites');
  if (wrong.length) diverge(t, {section: '§5.2 ("No oracle. An expired, revoked, exhausted, mismatched or unknown offer each admit nothing, reserve nothing and get the uniform 202"), §9.2 Response, §12.1, §21.1 Offers', request: 'three invites per dead-offer case', observed: wrong.join('; '), expected: 'nothing admitted; an identical 202 and timing class', side: 'implementation'});
}, {timeout: 120000});

test('§13.1 open-offer windows: the per-(principal, offer) window bounds one principal while other principals of the same issuer still dial; an unbased flood from that issuer and a new issuer do not lock the offer', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {wrong, expect} = checks();
  // Every principal used below is warmed first, on another offer (each invite cancelled at once): key refresh for a
  // new principal is bounded by fetch budgets with negative caching (§9.2 step 3), which must not decide these checks.
  const carolP = await w.peer.entity(), erinP = await w.peer.entity(), newcomer = await w.peers.floor.entity();
  for (const [who, peer] of [[carolP, w.peer], [erinP, w.peer], [newcomer, w.peers.floor]]) { const warm = await invite(ctx, {from: who, peer}); assert.ok(await deliver(ctx, warm, {timeout: 30000}), 'principal warmed'); await cancel(ctx, warm); }
  const token = (await ctx.mint({uses: 16})).offers[0].offer;
  let admitted = 0, limited = false;
  for (let i = 0; i < 10 && !limited; i++) {
    const inv = await invite(ctx, {token}); await w.peer.post(inv.batch);
    if (await delivered(ctx, inv.sid)) { admitted++; await cancel(ctx, inv); await ctx.waitEvent(e => e.sid === inv.sid && e.type === 'state', 3000); } else limited = true;
  }
  t.diagnostic(`one principal on one open offer: ${admitted} admitted before ${limited ? 'the window bound it' : 'the loop ended (10 dial-backs)'}`);
  // Each admitted invite is cancelled at once: open-offer sessions share a bounded sub-budget of pending capacity
  // (§13.1 "Open-offer sub-budget"), which must not decide these checks.
  const carolInv = await invite(ctx, {from: carolP, token}), carol = await deliver(ctx, carolInv);
  expect(carol, 'another principal of the same issuer could not dial the open offer after the first principal\'s window filled');
  if (carol) await cancel(ctx, carolInv);
  // An unbased flood from two warm principals of the same issuer, so every invite reaches step 7.
  for (let i = 0; i < 48; i++) await w.peer.post((await invite(ctx, {from: i % 2 ? carolP : ctx.bob, basis: null})).batch);
  const erinInv = await invite(ctx, {from: erinP, token}), erin = await deliver(ctx, erinInv);
  expect(erin, 'a principal of the flooding issuer could not dial the open offer after 48 unbased invites from that issuer');
  if (erin) await cancel(ctx, erinInv);
  const fresh = await invite(ctx, {from: newcomer, token, peer: w.peers.floor});
  expect(await deliver(ctx, fresh), 'a principal of a new issuer found no headroom on the open offer');
  if (!limited) diverge(t, {section: '§13.1 ("a window per (initiator origin principal, offer)", reference 6 per hour)', request: '10 dial-backs by one principal on one open offer (each released by a cancel)', observed: `${admitted} admitted, never bounded`, expected: 'bounded by the per-(principal, offer) window', side: 'implementation', intentional: true});
  if (wrong.length) diverge(t, {section: '§13.1 Open offers ("never charged to the per-recipient window, the per-(initiator, recipient) window or the per-(sending issuer, recipient) window"; per-issuer fair share)', request: 'one principal filling its window, an unbased flood from the same issuer, then other principals and a new issuer dialing the same open offer', observed: wrong.join('; '), expected: 'the other principals and the new issuer are admitted', side: 'implementation'});
}, {timeout: 180000});

test('§13.1 open-offer sub-budget: pending open-offer sessions are bounded below the entity\'s pending capacity, and a matched bound offer is still admitted once it is full', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {wrong, expect} = checks(), token = (await ctx.mint({uses: 16})).offers[0].offer, pending = [];
  let bounded = false;
  for (let i = 0; i < 6 && !bounded; i++) { const inv = await invite(ctx, {token}); await w.peer.post(inv.batch); if (await delivered(ctx, inv.sid)) pending.push(inv); else bounded = true; }
  t.diagnostic(`pending open-offer sessions admitted before the bound: ${pending.length}`);
  expect(bounded, `${pending.length} pending open-offer sessions admitted with no bound (the open-offer sub-budget is a required limit kind)`);
  const bound = (await ctx.mint({principals: [ctx.bob.principal]})).offers[0].offer, b = await invite(ctx, {token: bound});
  expect(await deliver(ctx, b), 'a matched bound-offer invite was not admitted while only the open-offer sub-budget was full');
  for (const inv of [...pending, b]) await cancel(ctx, inv);
  if (wrong.length) diverge(t, {section: '§13.1 ("Open-offer sub-budget. Sessions admitted on open offers get a bounded share of the entity\'s pending capacity"; "open-offer invites MUST NOT use the reserve")', request: 'pending open-offer sessions until one is not admitted, then a bound-offer invite', observed: wrong.join('; '), expected: 'a bound below the pending capacity; the bound offer still admitted', side: 'implementation'});
});

test('§13.2 blocks apply before any offer: a blocked principal or provider cannot use an open offer and its pending invites end silently; the own principal and issuer cannot be blocked', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {wrong, expect} = checks(), mallory = await w.peer.entity();
  const warm = await invite(ctx, {from: mallory}); assert.ok(await deliver(ctx, warm), 'second principal warmed'); await cancel(ctx, warm);
  const token = (await ctx.mint({uses: 8})).offers[0].offer;
  const pending = await invite(ctx, {token}); assert.ok(await deliver(ctx, pending), 'pending invite');
  const bp = await ctx.owner('block', {principal: ctx.bob.principal}); assert.equal(bp.status, 200, 'block principal: ' + await bp.clone().text());
  expect(await ctx.waitEvent(e => e.sid === pending.sid && e.type === 'state' && e.state === 'ended', 4000), 'blocking ended the blocked principal\'s pending invite at the endpoint');
  const blocked = await invite(ctx, {token}); await w.peer.post(blocked.batch);
  const m1 = await deliver(ctx, await invite(ctx, {from: mallory, token}));
  expect(m1, 'another principal of the same issuer could still use the open offer');
  expect(!ctx.has(e => e.type === 'invite' && e.sid === blocked.sid), 'the blocked principal used the open offer');
  const bi = await ctx.owner('block', {issuer: PEER}); assert.equal(bi.status, 200, 'block provider: ' + await bi.clone().text());
  const m2 = await invite(ctx, {from: mallory, token}); await w.peer.post(m2.batch);
  const floor = await w.peers.floor.entity(), f = await invite(ctx, {from: floor, token, peer: w.peers.floor});
  expect(await deliver(ctx, f), 'a principal of another issuer could still use the open offer');
  await sleep(500); await ctx.poll();
  expect(!ctx.has(e => e.type === 'invite' && e.sid === m2.sid), 'a principal of the blocked provider used the open offer');
  for (const [name, target] of [['own principal', {principal: ctx.acct.principal}], ['own issuer', {issuer: PROVIDER}]]) { const r = await ctx.owner('block', target); t.diagnostic(`block ${name} -> ${r.status}`); expect(r.status !== 200, `blocking the ${name} was accepted`); }
  await sleep(500);
  const leaked = peerSaw([pending.sid, blocked.sid, m2.sid]);
  expect(!leaked.length, `the initiator provider received ${leaked.map(m => m.payload.type ?? m.payload.bindle).join(', ')}`);
  if (wrong.length) diverge(t, {section: '§13.2 ("Blocks apply before any offer"; "Blocking ends the blocked party\'s pending invites silently"; Own-entity exemption)', request: 'principal and provider blocks against an open offer, with a pending invite', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

// ==== §3.5 the data profile ==========================================================================================
test('§3.5/§7.2 data profile: params {}, data only after the claim and only between the claimed legs, relayed unchanged; over 4 KiB, over 64 KiB per leg and in a webrtc session refused', async t => {
  const m = await w.peer.providerManifest(), profiles = ext(m, SIGNALING_EXT)?.profiles ?? [];
  if (!profiles.includes('data')) { t.skip(`the provider does not declare the data profile (profiles ${JSON.stringify(profiles)}); §3.5 lets it relay only declared profiles`); return; }
  const ctx = await callee({kinds: [LINE, DATA_LINE]}); await beacon(ctx);
  const {wrong, expect} = checks();
  const token = (await ctx.mint({kind: DATA_LINE, profile: 'data', uses: 4})).offers[0].offer;
  const inv = await invite(ctx, {kind: REF[DATA_LINE], profile: 'data', token}), e = await deliver(ctx, inv);
  assert.ok(e, 'data-profile invite admitted');
  expect(e.projection.profile === 'data' && JSON.stringify(e.projection.params) === '{}', `projection profile ${e.projection.profile}, params ${JSON.stringify(e.projection.params)}`);
  const badParams = await invite(ctx, {kind: REF[DATA_LINE], profile: 'data', token, params: {offer: null}}); const bp = await w.peer.post(badParams.batch);
  t.diagnostic(`data invite with webrtc params -> ${bp.status}`);
  // Pre-claim data from the initiator leg: dropped at step 7 after step 5 consumed seq 1.
  const pre = await w.peer.message({leg: inv.leg, sub: inv.from.sub, aud: ctx.acct.identity, sid: inv.sid, to: randomId(32), seq: 1, type: 'data', body: dataBody(16)});
  await w.peer.post(w.peer.batch({messages: [pre]}));
  await sleep(300);
  const s = await accept(ctx, inv); s.peerSeq = 2;
  expect(!ctx.has(x => x.message === pre), 'pre-claim data reached the endpoint');
  const acc = w.peer.messages(inv.sid).find(x => x.payload.type === 'accept');
  expect(JSON.stringify(acc?.payload.body) === JSON.stringify({params: {}}), `accept body ${JSON.stringify(acc?.payload.body)}`);
  const first = await peerSend(ctx, s, 'data', dataBody(32));
  expect(first.got, 'post-claim data from the peer (seq 2, after the consumed pre-claim seq 1) was not delivered');
  const out = await appMessage(ctx, s, {seq: s.appSeq++, type: 'data', body: dataBody(48, 9)}), sent = await ctx.c.call('send', {...ctx.ep, sid: s.sid, messages: [out]});
  expect(sent.result?.accepted === 1 && await w.peer.until(() => w.peer.messages(s.sid).some(x => x.jws === out), {timeout: 4000}), `app data relayed unchanged: ${JSON.stringify(sent.error ?? sent.result)}`);
  // The provider's own endpoint, in a second data session: over 4 KiB, and over the leg cap.
  const inv2 = await invite(ctx, {kind: REF[DATA_LINE], profile: 'data', token}); assert.ok(await deliver(ctx, inv2), 'second data session admitted');
  const s2 = await accept(ctx, inv2);
  const bigOut = await appMessage(ctx, s2, {seq: s2.appSeq, type: 'data', body: dataBody(DATA_LIMITS.message + 1)}), bo = await ctx.c.call('send', {...ctx.ep, sid: s2.sid, messages: [bigOut]});
  t.diagnostic(`send of a 4,097-byte payload -> ${JSON.stringify(bo.error ?? bo.result)}`);
  expect(errorCode(bo) === 'invalid_args', `send of a 4,097-byte payload: ${bo.result ? 'accepted' : errorCode(bo)}`);
  let outTotal = 0, refusedAt = null;
  for (let i = 0; i < 17 && refusedAt === null; i++) { const msg = await appMessage(ctx, s2, {seq: s2.appSeq, type: 'data', body: dataBody(DATA_LIMITS.message, i)}); const r = await ctx.c.call('send', {...ctx.ep, sid: s2.sid, messages: [msg]}); if (r.result?.accepted === 1) { s2.appSeq++; outTotal += DATA_LIMITS.message; } else refusedAt = {total: outTotal, code: errorCode(r), answer: r.error ?? r.result}; }
  t.diagnostic(`own endpoint data refused at ${JSON.stringify(refusedAt)}`);
  expect(refusedAt && refusedAt.total + DATA_LIMITS.message > DATA_LIMITS.leg && ['invalid_args', 'rate_limited'].includes(refusedAt.code), `own endpoint's data past 64 KiB per leg: ${JSON.stringify(refusedAt ?? {accepted: outTotal})}`);
  // Over 4 KiB from the peer.
  const big = await w.peer.message({leg: s.peerLeg, sub: s.from.sub, aud: ctx.acct.identity, sid: s.sid, to: s.appLeg.jkt, seq: s.peerSeq, type: 'data', body: dataBody(DATA_LIMITS.message + 1)});
  const bigPost = await w.peer.post(w.peer.batch({messages: [big]}));
  if (bigPost.status !== 400) s.peerSeq++;
  await sleep(300); await ctx.poll();
  expect(!ctx.has(x => x.message === big), `a 4,097-byte data payload was delivered (post ${bigPost.status})`);
  // Per-leg 64 KiB: 32 bytes so far; 15 x 4,096 brings it to 61,472; one more 4,096 would pass 65,536.
  let fill = 32;
  for (let i = 0; i < 15; i++) { const r = await peerSend(ctx, s, 'data', dataBody(DATA_LIMITS.message, i), {timeout: 3000}); if (!r.got) { expect(false, `data within the 64 KiB leg cap not delivered at ${fill} bytes`); break; } fill += DATA_LIMITS.message; }
  const over = await peerSend(ctx, s, 'data', dataBody(DATA_LIMITS.message, 99), {timeout: 2500});
  expect(!over.got, `data past the 64 KiB per-leg cap delivered (leg total ${fill + DATA_LIMITS.message})`);
  const endedOver = await ctx.waitEvent(e => e.sid === s.sid && e.type === 'state', 1500);
  t.diagnostic(`after the peer's leg passed 64 KiB: ${endedOver ? 'state ' + endedOver.state : 'session still live'}`);
  // `data` in a webrtc session (the beacon), both directions.
  const b = ctx.beacon, wd = await peerSend(ctx, b, 'data', dataBody(8), {timeout: 2000, l: ctx});
  if (!wd.got) b.peerSeq--; // a step-1 refusal (400) consumes nothing
  expect(!wd.got, 'data in a webrtc session reached the endpoint');
  const wo = await appMessage(ctx, b, {seq: b.appSeq, type: 'data', body: dataBody(8)}), wr = await ctx.c.call('send', {...ctx.ep, sid: b.sid, messages: [wo]});
  expect(errorCode(wr) === 'invalid_args', `send of data in a webrtc session: ${wr.result ? 'accepted' : errorCode(wr)}`);
  if (wrong.length) diverge(t, {section: '§3.5 data ("payload is base64url of 1 to 4,096 opaque bytes; a leg\'s payloads total at most 65,536 bytes"; "A data message in a session of any other profile is invalid"), §7.2 ("Before the claim, the initiator leg sends nothing but invite and cancel"), §10.2 send', request: 'a data-profile session over the offer basis', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
}, {timeout: 120000});

// ==== §9.2 transport =================================================================================================
test('§9.2 step 1 (AMD-RW2): the public endpoint refuses elements whose iss is this provider\'s own issuer', async t => {
  const a = await callee(), b = await w.account(), leg = await keyPair(), sid = newSid(), {wrong, expect} = checks();
  const as = {iss: PROVIDER, sub: a.acct.sub};
  const cert = await w.peer.legCertificate({sub: a.bob.sub, aud: b.identity, sid, role: 'initiator', kind: KIND, leg, override: {...as, identity: a.acct.identity}});
  const msg = await w.peer.message({leg, sub: a.bob.sub, aud: b.identity, sid, seq: 0, type: 'invite', body: {kind: KIND, profile: 'webrtc', answer_by: now() + 60, basis: {offer_digest: await offerDigest(randomId(32))}, context: null, params: {offer: null}}, override: as});
  const ctl = await w.peer.control({sub: a.bob.sub, aud: b.identity, sid, override: as});
  const cases = {'certificate and invite from this issuer': w.peer.batch({certificates: [cert], messages: [msg]}), 'a control statement from this issuer': w.peer.batch({controls: [ctl]}), 'a message from this issuer': w.peer.batch({messages: [msg]})};
  for (const [name, batch] of Object.entries(cases)) { const r = await w.peer.post(batch); t.diagnostic(`${name} -> ${r.status}`); expect(r.status === 400, `${name} -> ${r.status}`); }
  if (wrong.length) diverge(t, {section: '§9.2 step 1 ("At the public endpoint, refuse any element whose iss is this provider\'s own issuer"; "A batch in which any element fails this step is refused as a whole"), §9.4', request: 'batches whose elements claim iss = the provider\'s own issuer', observed: wrong.join('; '), expected: '400', side: 'implementation'});
});

test('§9.2/§12.1 per-entity enablement: an entity outside the rollout and one that never enabled signaling answer like an enabled one (202 alike, 400 for a step-1-invalid batch) and nothing is processed for the dark one', async t => {
  const v = await boot();
  try {
    const {wrong, expect} = checks(), bob = await v.peer.entity();
    const on = await v.account(), dark = await v.account(), never = await v.account();
    const conn = {on: await v.connect(on), dark: await v.connect(dark)};
    const reg = {on: auth(await conn.on.call('register', {kinds: [LINE]})), dark: auth(await conn.dark.call('register', {kinds: [LINE]}))};
    const tokens = {on: (await conn.on.call('offer', {...reg.on, kind: LINE, profile: 'webrtc', uses: 16, expires_in: 900})).result.offers[0].offer, dark: (await conn.dark.call('offer', {...reg.dark, kind: LINE, profile: 'webrtc', uses: 16, expires_in: 900})).result.offers[0].offer, never: randomId(32)};
    const listen = {on: listener(conn.on, reg.on), dark: listener(conn.dark, reg.dark)};
    // Warm bob's keys at the provider through the enabled account (a held-key miss is otherwise indistinguishable).
    const warmCtx = {acct: on}, warm = await invite(warmCtx, {from: bob, token: tokens.on, peer: v.peer});
    let warmed = null; for (let i = 0; i < 6 && !warmed; i++) { await v.peer.post(warm.batch); warmed = await listen.on.waitEvent(e => e.type === 'invite' && e.sid === warm.sid, 1500); }
    assert.ok(warmed, 'peer keys warmed through the enabled account');
    await v.app.resources.flagsRuntime.publish({v: 1, version: 1, issuedAt: 0, flags: {SIGNALING_ENABLED: {rev: 1, on: true, onValue: true, fallthrough: true, salt: 'conformance-rollout', deny: {accounts: [dark.sub], clients: []}}}});
    const accounts = {on, dark, never}, rows = {};
    for (const [name, acct] of Object.entries(accounts)) {
      rows[name] = {valid: [], invalid: []};
      for (let i = 0; i < 4; i++) {
        const inv = await invite({acct}, {from: bob, token: tokens[name], peer: v.peer}); rows[name].sids = [...rows[name].sids ?? [], inv.sid];
        const t0 = performance.now(), r = await v.peer.post(inv.batch);
        rows[name].valid.push({ms: performance.now() - t0, status: r.status, body: r.body, type: r.headers.get('content-type'), cache: r.headers.get('cache-control')});
        const bad = await v.peer.post({...inv.batch, messages: [malleate(inv.message)]});
        rows[name].invalid.push({status: bad.status, type: bad.headers.get('content-type')});
      }
    }
    const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1], ref = rows.on.valid[0];
    for (const [name, r] of Object.entries(rows)) {
      for (const x of r.valid) expect(x.status === 202 && x.body === '' && x.type === ref.type && x.cache === ref.cache, `${name}: valid batch -> ${JSON.stringify(x)}`);
      for (const x of r.invalid) expect(x.status === 400 && x.type === rows.on.invalid[0].type, `${name}: step-1-invalid batch -> ${JSON.stringify(x)}`);
      const m = median(r.valid.map(x => x.ms)), b = median(rows.on.valid.map(x => x.ms));
      t.diagnostic(`${name}: median ${m.toFixed(1)} ms (enabled ${b.toFixed(1)} ms)`);
      expect(Math.abs(m - b) < 60, `${name}: median response ${m.toFixed(1)} ms against ${b.toFixed(1)} ms when enabled`);
    }
    expect(await listen.on.waitEvent(e => e.type === 'invite' && rows.on.sids.includes(e.sid), 4000), 'the enabled account received its invites');
    await sleep(1000);
    const darkView = await (await v.request('/api/signaling/settings', dark.owner)).json();
    t.diagnostic(`dark account: settings.enabled ${darkView.enabled}, live sessions ${(darkView.sessions ?? []).length}`);
    expect(!(darkView.sessions ?? []).some(s => rows.dark.sids.includes(s.sid)), 'a session was recorded for the dark account');
    if (wrong.length) diverge(t, {section: '§9.2 Response ("Per-entity enablement ... MUST NOT change the response, its timing class or the queue behaviour ... then dropped unprocessed"), §12.1', request: 'valid and step-1-invalid batches to an enabled entity, an entity denied by the rollout and an entity that never connected an app', observed: wrong.join('; '), expected: 'identical 202 (and 400) answers and timing class; the dark entity processes nothing', side: 'implementation'});
  } finally { await v.close(); }
}, {timeout: 120000});

// ==== not exercisable in this deployment ============================================================================
test('§4.2/§5.4 case 3/§5.7 provider-feature and service-class endpoints (offers from them, routing to online endpoints, auto-decline)', t => {
  t.skip('not exercisable through this deployment\'s public surfaces: no provider feature consumes the signaling fragment (the provider declares none), and a service-class app endpoint needs an organization entity whose owner set the service designation through its owner interface, which this suite does not drive. §21.1 lists these first at the engine level.');
});

