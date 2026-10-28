// Clean-room signaling conformance (signaling.v1 rev 3.2, Appendix C.5 step 6), §21.2 "New, needed by this draft": approval
// and routing, own-entity and cross-entity pairings (the relation basis), bases enforcement and glare.
// Shared world, conventions and seams: tests/helpers/signaling-conformance-world.mjs. Divergences are t.todo in normal
// mode and fail under SIGNALING_CONFORMANCE_STRICT=1 unless marked plausibly intentional.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// The implementation's §8.3 endpoint-rule helper, compared with the peer's clean-room ranks (the only implementation
// module imported besides the server under test; the peer imports none).
import {glareSurvivor} from '../packages/signaling/sessions.mjs';
import {APP, DATA_LINE, KIND, LINE, OFFER_LINE, OTHER_APP, PAIR_LINE, PEER, PROVIDER, REF, SELF_LINE, accept, appMessage, auth, beacon, callee, cancel, checks, decline, deliver, delivered, diverge, endpoint, errorCode, invite, listener, openSelf, pair, peerSaw, sawInvite, sleep, test, urlsIn, useWorld, w} from './helpers/signaling-conformance-world.mjs';
import {keyPair, now, sdp, offerDigest, part, sign, b64, TYP, MAGIC, randomId, glareRanks, glareOutcome} from './signaling-conformance-peer.mjs';

useWorld();
// ==== §20.1.4 / §10.2 approval_required ==============================================================================
test('§10.2/§20.1.4 register, open and offer for a kind the app is not approved for answer approval_required with a provider-origin page URL', async t => {
  const acct = await w.account(), c = await w.connect(acct, {approve: [DATA_LINE]}), bob = await w.peer.entity();
  const ok = await c.call('register', {kinds: [DATA_LINE]}); assert.equal(ok.status, 200, 'an approved kind registers: ' + JSON.stringify(ok));
  const ep = auth(ok), leg = await keyPair();
  const answers = {
    'register (unapproved kind)': await c.call('register', {kinds: [LINE]}),
    'register (approved and unapproved kinds)': await c.call('register', {kinds: [DATA_LINE, LINE]}),
    'open (unapproved kind)': await c.call('open', {...ep, to: bob.principal, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: leg.jwk, basis: {offer: w.peer.mintOffer()}}),
    'offer (unapproved kind)': await c.call('offer', {...ep, kind: LINE, profile: 'webrtc', expires_in: 900})
  };
  const {wrong, expect} = checks();
  for (const [name, r] of Object.entries(answers)) {
    t.diagnostic(`${name} -> ${r.status} ${JSON.stringify(r.error ?? r.result)}`);
    expect(!r.result, `${name}: succeeded`);
    expect(errorCode(r) === 'approval_required', `${name}: code ${errorCode(r)}`);
    const urls = urlsIn(r.error);
    expect(urls.length > 0 && urls.every(u => new URL(u).origin === PROVIDER), `${name}: page URL ${JSON.stringify(urls)}`);
  }
  if (wrong.length) diverge(t, {section: '§10.2 open/register ("approval_required (with a provider page URL) means the app is not an approved handler"), offer ("approval_required as for open"), §20.1.4 ("That answer carries the URL of a provider page on the provider\'s own origin")', request: 'register, open and offer naming an unapproved kind line', observed: wrong.join('; '), expected: 'error approval_required carrying a provider-origin page URL', side: 'implementation'});
});

// ==== §5.4 routing ===================================================================================================
test('§5.4 cases 1 and 2: an own-entity invite reaches only the initiating app (or its same-app target), never another app; a target of another, unpaired app is refused', async t => {
  const acct = await w.account(), a = await w.connect(acct, {approve: [DATA_LINE]}), b = await w.connect(acct, {client: OTHER_APP, approve: [DATA_LINE]});
  const a1 = await endpoint(a, [DATA_LINE]), a2 = await endpoint(a, [DATA_LINE]), a3 = await endpoint(a, [DATA_LINE]), b1 = await endpoint(b, [DATA_LINE]);
  const {wrong, expect} = checks();
  const s = await openSelf(acct, a1); assert.ok(s.sid, 'own-entity open: ' + JSON.stringify(s.error));
  const e2 = await a2.waitEvent(e => e.type === 'invite' && e.sid === s.sid), e3 = await a3.waitEvent(e => e.type === 'invite' && e.sid === s.sid);
  expect(e2 && e3, 'case 2: every eligible endpoint of the initiating app received the invite');
  expect(!await sawInvite(a1, s.sid), 'case 2: not delivered to the initiating endpoint itself (§5.4 "not the initiator\'s own endpoint")');
  expect(!await sawInvite(b1, s.sid), 'case 2: not delivered to another app of the owner');
  if (e2) {
    const p = e2.projection;
    expect(p.basis === 'self', `projection basis ${p.basis}`);
    expect(JSON.stringify(p.initiator) === JSON.stringify(acct.principal), 'projection initiator is the owner');
    expect(p.client_id === APP.id && p.reported_by === null, `projection client_id ${p.client_id}, reported_by ${p.reported_by}`);
    expect(p.auto_connect === false && p.paired === false && p.offer_match === false, `auto_connect ${p.auto_connect}, paired ${p.paired}, offer_match ${p.offer_match} (a kind that is not \`self\`, no pairing, no offer)`);
  }
  const target = await openSelf(acct, a1, {target: a3.ep.endpoint}); assert.ok(target.sid, 'own-entity open with a same-app target: ' + JSON.stringify(target.error));
  expect(await a3.waitEvent(e => e.type === 'invite' && e.sid === target.sid), 'case 1: the target received the invite');
  expect(!await sawInvite(a2, target.sid), 'case 1: no other endpoint received it');
  const other = await openSelf(acct, a1, {target: b1.ep.endpoint});
  t.diagnostic(`open with a target of another, unpaired app -> ${JSON.stringify(other.error ?? other.sid)}`);
  expect(other.error && errorCode({error: other.error}) === 'invalid_args', `a target of another, unpaired app: ${other.sid ? 'certified' : JSON.stringify(other.error)}`);
  if (wrong.length) diverge(t, {section: '§5.4 cases 1 and 2, §5.1 item 6, §10.3 projection', request: 'own-entity opens without target, with a same-app target and with a target of another app', observed: wrong.join('; '), expected: 'routing to the initiating app (or its target) only; another app\'s target refused with invalid_args', side: 'implementation'});
});

test('§5.4 late delivery: an own-entity invite whose routing set is empty stays pending and reaches a same-app endpoint that registers before answer_by', async t => {
  const acct = await w.account(), a = await w.connect(acct, {approve: [DATA_LINE]}), a1 = await endpoint(a, [DATA_LINE]);
  const s = await openSelf(acct, a1, {answerIn: 60}); assert.ok(s.sid, JSON.stringify(s.error));
  await sleep(800);
  const late = await endpoint(a, [DATA_LINE]);
  const e = await late.waitEvent(x => x.type === 'invite' && x.sid === s.sid, 8000);
  if (!e) diverge(t, {section: '§5.4 ("A pending invite is also delivered to an eligible endpoint of the routing set that registers or starts listen before answer_by")', request: 'an own-entity invite with no other endpoint of the app, then a new endpoint of the app registers and listens', observed: 'not delivered within 8 s', expected: 'late delivery to the new endpoint', side: 'implementation'});
});

test('§5.2/§5.4 case 3: an offer-basis invite whose routing set is empty admits nothing and takes no use, so no late delivery holds one', async t => {
  const ctx = await callee(); await beacon(ctx);
  const {offers} = await ctx.mint({uses: 1}), token = offers[0].offer;
  // Unregister every endpoint of the minting app: the routing set (§5.4 case 3) is empty.
  for (const ep of [ctx.ep]) assert.equal((await ctx.c.call('unregister', ep)).status, 200);
  const inv = await invite(ctx, {token}); assert.equal((await w.peer.post(inv.batch)).status, 202);
  await sleep(1200);
  const {wrong, expect} = checks();
  const state = await ctx.offerState(token);
  t.diagnostic(`offer after the empty-routing-set dial-back: ${JSON.stringify(state && {spent: state.spent, reserved: state.reserved})}`);
  expect(state && state.spent === 0 && state.reserved === 0, `uses taken: ${JSON.stringify(state && {spent: state.spent, reserved: state.reserved})}`);
  const fresh = await ctx.register();
  expect(!await fresh.waitEvent(e => e.type === 'invite' && e.sid === inv.sid, 3000), 'the unadmitted invite reached an endpoint registered later');
  const again = await invite(ctx, {token});
  expect(await deliver(fresh, again), 'the offer\'s use was still free for a later dial-back');
  if (wrong.length) diverge(t, {section: '§5.2 ("A mismatch, or an empty routing set, admits nothing and takes nothing"), §5.4 ("An offer-basis invite whose routing set is empty at admission is not admitted at all")', request: 'a dial-back on a uses:1 open offer while the minting app has no endpoint, then a new endpoint registers', observed: wrong.join('; '), expected: 'nothing admitted, no use taken, no late delivery; the use stays free', side: 'implementation'});
});

test('§5.4 a foreign initiator\'s asserted client_id never affects routing; offer_match is false on endpoints that are not the minting endpoint', async t => {
  const ctx = await callee(), other = await w.connect(ctx.acct, {client: OTHER_APP}), o1 = await endpoint(other, [LINE]), a2 = await ctx.register();
  await beacon(ctx);
  const {wrong, expect} = checks();
  // The peer asserts OTHER_APP's client identity in its certificate; the offer was minted by APP's main endpoint.
  const inv = await invite(ctx, {certOverride: {client: {client_id: OTHER_APP.id, origin: OTHER_APP.origin, feature: null}}});
  const e = await deliver(ctx, inv); assert.ok(e, 'delivered to the minting endpoint');
  expect(e.projection.client_id === OTHER_APP.id && e.projection.reported_by === PEER, `the asserted client is only reported: client_id ${e.projection.client_id}, reported_by ${e.projection.reported_by}`);
  expect(e.projection.offer_match === true && e.projection.paired === false && e.projection.auto_connect === false, `minting endpoint: offer_match ${e.projection.offer_match}, paired ${e.projection.paired}, auto_connect ${e.projection.auto_connect}`);
  expect(!await sawInvite(o1, inv.sid), 'routed to the app the asserted client_id names');
  expect(!await sawInvite(a2, inv.sid), 'routed to another endpoint of the minting app while the minting endpoint is eligible');
  // §5.4 case 3: the minting endpoint gone, the invite routes to the app's other eligible endpoints with offer_match false.
  const minter = await ctx.register(), {offers} = await ctx.mint({uses: 2}, minter.ep);
  assert.equal((await ctx.c.call('unregister', minter.ep)).status, 200);
  const inv2 = await invite(ctx, {token: offers[0].offer}), e2 = await deliver(a2, inv2);
  expect(e2, 'routed to the minting app\'s other eligible endpoints once the minting endpoint is gone');
  if (e2) expect(e2.projection.offer_match === false, `offer_match on an endpoint that is not the minting endpoint: ${e2.projection.offer_match}`);
  expect(!await sawInvite(o1, inv2.sid), 'never routed to another app');
  if (wrong.length) diverge(t, {section: '§5.4 ("A foreign initiator\'s asserted client_id and origin never influence routing"), §5.4 case 3, §10.3 offer_match', request: 'offer-basis invites whose certificate asserts another app\'s client_id; minting endpoint present, then unregistered', observed: wrong.join('; '), expected: 'routing by the offer\'s minting app only; offer_match true only on the minting endpoint', side: 'implementation'});
});

test('§5.5/§10.3 auto-connect is projected only for a same-app own-entity invite of a `self` kind with the owner setting on', async t => {
  const acct = await w.account(), a = await w.connect(acct, {approve: [SELF_LINE, DATA_LINE]});
  const a1 = await endpoint(a, [SELF_LINE, DATA_LINE]), a2 = await endpoint(a, [SELF_LINE, DATA_LINE]);
  const {wrong, expect} = checks();
  const off = await openSelf(acct, a1, {kind: SELF_LINE}); assert.ok(off.sid, JSON.stringify(off.error));
  const e1 = await a2.waitEvent(e => e.type === 'invite' && e.sid === off.sid); assert.ok(e1, 'delivered');
  expect(e1.projection.auto_connect === false, `auto_connect with the owner setting off (default): ${e1.projection.auto_connect}`);
  const [on] = await w.widen(acct, [{action: 'session-auto-connect', input: {clientId: APP.id, kind: SELF_LINE, autoConnect: true}}]);
  assert.equal(on.status, 200, 'owner turns auto-connect on: ' + await on.clone().text());
  const s2 = await openSelf(acct, a1, {kind: SELF_LINE}), e2 = await a2.waitEvent(e => e.type === 'invite' && e.sid === s2.sid); assert.ok(e2, 'delivered');
  expect(e2.projection.auto_connect === true, `auto_connect for the same app with the setting on: ${e2.projection.auto_connect}`);
  expect(e2.projection.paired === false && e2.projection.offer_match === false, `paired ${e2.projection.paired}, offer_match ${e2.projection.offer_match}`);
  const [notSelf] = await w.widen(acct, [{action: 'session-auto-connect', input: {clientId: APP.id, kind: DATA_LINE, autoConnect: true}}]);
  t.diagnostic(`auto-connect on a kind whose parties is "any" -> ${notSelf.status}`);
  expect(notSelf.status !== 200, 'auto-connect accepted for a kind whose parties is not self');
  const s3 = await openSelf(acct, a1, {kind: DATA_LINE}), e3 = await a2.waitEvent(e => e.type === 'invite' && e.sid === s3.sid); assert.ok(e3, 'delivered');
  expect(e3.projection.auto_connect === false, `auto_connect for a kind that is not self: ${e3.projection.auto_connect}`);
  if (wrong.length) diverge(t, {section: '§5.5 ("same app: the kind\'s parties is self, the owner enabled auto-connect"), §20.1.4 (auto_connect "allowed only when parties is self")', request: 'own-entity invites of a self kind with the setting off and on, and of an `any` kind', observed: wrong.join('; '), expected: 'auto_connect true only for the self kind with the setting on', side: 'implementation'});
});

test('§5.4 case 4/§5.5/§5.8/§10.2 own-entity pairing: a covered target is allowed with paired and auto_connect projected; endpoints() discloses pairings and the opening side\'s view only; the side that may not open is refused', async t => {
  const acct = await w.account(), a = await w.connect(acct, {approve: [PAIR_LINE]}), b = await w.connect(acct, {client: OTHER_APP, approve: [PAIR_LINE]});
  const ra = await a.call('register', {kinds: [PAIR_LINE], label: 'app-written label A'}), rb = await b.call('register', {kinds: [PAIR_LINE], label: 'app-written label B'});
  const a1 = listener(a, auth(ra)), b1 = listener(b, auth(rb));
  const {wrong, expect} = checks();
  const before = await openSelf(acct, a1, {kind: PAIR_LINE, target: b1.ep.endpoint});
  expect(errorCode({error: before.error}) === 'invalid_args', `target of the other app before any pairing: ${before.sid ? 'certified' : JSON.stringify(before.error)}`);
  const p = await pair(acct, {self: OTHER_APP.id, opens: 'local'}); assert.equal(p.status, 200, 'own-entity pairing: ' + JSON.stringify(p.body));
  const id = p.body.id; expect(p.body.state === 'live', `pairing state ${p.body.state}`);
  // §5.8 "How an app learns its pairings": endpoints({endpoint}) on each covered side, and a `pairing` event.
  const la = await a.call('endpoints', {...a1.ep}), lb = await b.call('endpoints', {...b1.ep});
  const pa = (la.result?.pairings ?? []).find(x => x.id === id), pb = (lb.result?.pairings ?? []).find(x => x.id === id);
  expect(pa?.side === 'local' && pa?.peer?.client_id === OTHER_APP.id, `endpoints({endpoint}) on the local side: ${JSON.stringify(pa)}`);
  expect(pb?.side === 'peer' && pb?.peer?.client_id === APP.id, `endpoints({endpoint}) on the peer side: ${JSON.stringify(pb)}`);
  expect(pa && JSON.stringify(Object.keys(pa).sort()) === JSON.stringify(['expires_at', 'id', 'kind', 'opens', 'peer', 'side', 'state']), `pairings entry members: ${JSON.stringify(pa && Object.keys(pa))}`);
  expect(!JSON.stringify(la).includes('Conformance pairing'), 'the owner label of a pairing is disclosed to an app');
  expect(await a1.waitEvent(e => e.type === 'pairing' && e.pairing?.id === id, 3000) && await b1.waitEvent(e => e.type === 'pairing' && e.pairing?.id === id, 3000), 'a pairing event reached both covered endpoints');
  // endpoints({pairing}): only the opening side gets the other side's endpoints, with the provider's own label and no last_seen.
  const da = await a.call('endpoints', {...a1.ep, pairing: id}), db = await b.call('endpoints', {...b1.ep, pairing: id});
  const listed = JSON.stringify(da.result ?? da.error), seen = (da.result?.endpoints ?? []).find(x => x.endpoint === b1.ep.endpoint);
  t.diagnostic(`endpoints({pairing}) from the opening side: ${listed.slice(0, 400)}`);
  expect(seen, 'the opening side sees the covered endpoint of the other app');
  if (seen) { expect(seen.label !== 'app-written label B', 'the paired endpoint is labelled with the app-written register label'); expect(!('last_seen' in seen), 'last_seen disclosed for another app\'s endpoint'); expect(seen.client_id === OTHER_APP.id, `client_id ${seen.client_id}`); }
  expect(!(db.result?.endpoints ?? []).some(x => x.endpoint === a1.ep.endpoint), 'the answering side got the opening side\'s endpoints');
  const s = await openSelf(acct, a1, {kind: PAIR_LINE, target: b1.ep.endpoint});
  expect(s.sid, `a covered target of the paired app: ${JSON.stringify(s.error)}`);
  if (s.sid) {
    const e = await b1.waitEvent(x => x.type === 'invite' && x.sid === s.sid);
    expect(e, 'the covered target received the invite');
    if (e) expect(e.projection.basis === 'pairing' && e.projection.paired === true && e.projection.auto_connect === true, `projection basis ${e.projection.basis}, paired ${e.projection.paired}, auto_connect ${e.projection.auto_connect}`);
  }
  const back = await openSelf(acct, b1, {kind: PAIR_LINE, target: a1.ep.endpoint});
  expect(errorCode({error: back.error}) === 'invalid_args', `target from the side that may not open (opens: local): ${back.sid ? 'certified' : JSON.stringify(back.error)}`);
  if (wrong.length) diverge(t, {section: '§5.4 case 4, §5.5, §5.8 ("Own-entity pairing extends self", "How an app learns its pairings", "Discovery"), §10.2 endpoints, §10.3', request: 'own-entity pairing APP -> OTHER_APP (opens: local), endpoints() and targeted opens from both sides', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

// ==== §9.4 same-provider sessions ====================================================================================
test('§9.4/§5.7/§12.1 same-provider sessions: a dial-back between two entities of this provider is admitted on the offer basis through the internal path and connects; open succeeds alike toward an entity that never enabled signaling', async t => {
  const {wrong, expect} = checks();
  const a = await callee(), bAcct = await w.account(), b = await w.connect(bAcct), b1 = await endpoint(b, [LINE]);
  const token = (await a.mint({uses: 2})).offers[0].offer, leg = await keyPair();
  const o = await b.call('open', {...b1.ep, to: a.acct.principal, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: leg.jwk, basis: {offer: token}});
  assert.ok(o.result?.certificate, 'same-provider open on an offer: ' + JSON.stringify(o.error));
  const sid = o.result.sid ?? part(o.result.certificate, 1).sid;
  const inviteMsg = await sign({alg: 'ES256', typ: TYP.message, kid: leg.jkt}, {bindle: MAGIC.message, v: 1, iss: PROVIDER, sub: bAcct.sub, aud: a.acct.identity, sid, leg: leg.jkt, to: null, seq: 0, iat: now(), type: 'invite', body: {kind: KIND, profile: 'webrtc', answer_by: now() + 100, basis: {offer_digest: await offerDigest(token)}, context: null, params: {offer: sdp()}}}, leg);
  assert.equal((await b.call('send', {...b1.ep, sid, messages: [inviteMsg]})).result?.accepted, 1, 'invite sent');
  const e = await a.waitEvent(x => x.type === 'invite' && x.sid === sid, 8000);
  expect(e, 'the same-provider invite reached the minting endpoint');
  if (e) {
    const p = e.projection;
    expect(p.basis === 'offer' && p.offer_match === true && p.paired === false && p.reported_by === null, `projection basis ${p.basis}, offer_match ${p.offer_match}, paired ${p.paired}, reported_by ${p.reported_by}`);
    expect(JSON.stringify(p.initiator) === JSON.stringify(bAcct.principal) && p.client_id === APP.id, `projection initiator ${JSON.stringify(p.initiator)}, client_id ${p.client_id}`);
    expect(!JSON.stringify(e).includes(token), 'the offer token appeared in a listen event');
    const appLeg = await keyPair(), cl = await a.c.call('claim', {...a.ep, sid, outcome: 'accept', delegate: appLeg.jwk});
    expect(cl.result?.certificate, `claim: ${JSON.stringify(cl.error)}`);
    if (cl.result?.certificate) {
      const acc = await appMessage(a, {sid, appLeg, peerLeg: {jkt: leg.jkt}, peerIdentity: bAcct.identity}, {seq: 0, type: 'accept', body: {params: {answer: sdp({setup: 'active'})}}});
      expect((await a.c.call('send', {...a.ep, sid, messages: [acc]})).result?.accepted === 1, 'accept sent');
      expect(await b1.waitEvent(x => x.type === 'message' && x.message === acc, 6000), 'the accept reached the initiating endpoint');
      await sleep(300); const st = await a.offerState(token);
      expect(st && st.spent === 1 && st.reserved === 0, `the accept spent the open offer's use: ${JSON.stringify(st && {spent: st.spent, reserved: st.reserved})}`);
    }
  }
  expect(!w.peer.received.some(x => x.text?.includes(sid)), 'the same-provider session crossed the public path to another provider');
  // A bound offer of this provider presented by the wrong same-provider principal admits nothing.
  const bound = (await a.mint({principals: [a.bob.principal]})).offers[0].offer, leg2 = await keyPair();
  const o2 = await b.call('open', {...b1.ep, to: a.acct.principal, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: leg2.jwk, basis: {offer: bound}});
  if (o2.result?.certificate) {
    const sid2 = o2.result.sid ?? part(o2.result.certificate, 1).sid;
    const m2 = await sign({alg: 'ES256', typ: TYP.message, kid: leg2.jkt}, {bindle: MAGIC.message, v: 1, iss: PROVIDER, sub: bAcct.sub, aud: a.acct.identity, sid: sid2, leg: leg2.jkt, to: null, seq: 0, iat: now(), type: 'invite', body: {kind: KIND, profile: 'webrtc', answer_by: now() + 100, basis: {offer_digest: await offerDigest(bound)}, context: null, params: {offer: sdp()}}}, leg2);
    await b.call('send', {...b1.ep, sid: sid2, messages: [m2]});
    expect(!await a.waitEvent(x => x.type === 'invite' && x.sid === sid2, 2500), 'a bound offer admitted a same-provider principal it does not name');
  } else t.diagnostic(`open on a bound offer by another principal -> ${JSON.stringify(o2.error)} (the initiator provider cannot check an offer, §5.7 "Dialing back")`);
  // §12.1: `open` succeeds alike for any active entity, whether or not it ever enabled signaling.
  const never = await w.account(), opens = {};
  for (const [name, to] of [['an entity that never enabled signaling', never.principal], ['an enabled entity', a.acct.principal]]) { const r = await b.call('open', {...b1.ep, to, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: (await keyPair()).jwk, basis: {offer: randomId(32)}}); opens[name] = r.result?.certificate ? 'certificate' : JSON.stringify(r.error); }
  t.diagnostic(`open results: ${JSON.stringify(opens)}`);
  expect(new Set(Object.values(opens)).size === 1 && opens['an enabled entity'] === 'certificate', `open toward entities that did and did not enable signaling: ${JSON.stringify(opens)}`);
  if (wrong.length) diverge(t, {section: '§9.4 ("Sessions between two entities on one provider run the full §9.2 path ... through an internal transport"), §5.2, §5.7, §12.1 ("open succeeds alike for any active entity")', request: 'a same-provider dial-back on an open offer, a wrong-principal bound offer, and opens toward an entity that never enabled signaling', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

// ==== §10.2 retention ================================================================================================
test('§10.2 retention: write results carrying an offer token or a leg certificate are never journaled; a retried tx answers indeterminate', async t => {
  const ctx = await callee(), {wrong, expect} = checks();
  const cases = [
    ['offer', {...ctx.ep, kind: LINE, profile: 'webrtc', expires_in: 600}],
    ['open', {...ctx.ep, to: ctx.bob.principal, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: (await keyPair()).jwk, basis: {offer: randomId(32)}}]
  ];
  for (const [method, args] of cases) {
    const tx = randomUUID(), first = await ctx.c.callTx(tx, method, args), again = await ctx.c.callTx(tx, method, args);
    t.diagnostic(`${method}: first ${first.result ? 'result' : JSON.stringify(first.error)}; retried tx -> ${JSON.stringify(again.error ?? Object.keys(again.result ?? {}))}`);
    expect(first.result, `${method}: first call failed: ${JSON.stringify(first.error)}`);
    const secret = method === 'offer' ? first.result?.offers?.[0]?.offer : first.result?.certificate;
    expect(!secret || !JSON.stringify(again).includes(secret), `${method}: a retried tx returned the journaled ${method === 'offer' ? 'offer token' : 'leg certificate'}`);
    expect(errorCode(again) === 'indeterminate', `${method}: retried tx answered ${again.result ? 'a new result' : errorCode(again)}`);
  }
  if (wrong.length) diverge(t, {section: '§10.2 Retention ("Write results that carry a leg certificate or an offer token are never retained in an RPC journal. A retried tx answers indeterminate.")', request: 'offer and open, each retried with the same tx', observed: wrong.join('; '), expected: 'indeterminate, and never the earlier secret', side: 'implementation'});
});

// ==== §5.8 relation basis ============================================================================================
test('§5.2/§5.8 relation basis: admitted only under the recipient\'s live pairing for (verified principal, kind line), routed to covered endpoints with paired true; uniform 202 and nothing otherwise; removal ends pending invites silently and claimed sessions with revoked', async t => {
  const ctx = await callee({kinds: [LINE, PAIR_LINE]}); await beacon(ctx);
  const other = await w.connect(ctx.acct, {client: OTHER_APP, approve: [PAIR_LINE]}), o1 = await endpoint(other, [PAIR_LINE]);
  const {wrong, expect} = checks(), mallory = await w.peer.entity();
  const warm = await invite(ctx, {from: mallory}); assert.ok(await deliver(ctx, warm), 'second principal warmed'); await cancel(ctx, warm);
  const rel = (o = {}) => invite(ctx, {kind: REF[PAIR_LINE], profile: 'data', basis: {relation: 'pairing'}, ...o});
  const none = await rel(); await w.peer.post(none.batch);
  expect(!await delivered(ctx, none.sid), 'admitted with no pairing');
  const p = await pair(ctx.acct, {principal: ctx.bob.principal}); assert.equal(p.status, 200, 'cross-entity pairing: ' + JSON.stringify(p.body));
  expect(p.body.state === 'live' && typeof p.body.expires_at === 'number', `pairing ${JSON.stringify({state: p.body.state, expires_at: p.body.expires_at})} (a cross-entity pairing always expires)`);
  const dup = await pair(ctx.acct, {principal: ctx.bob.principal, activate: false});
  expect(dup.status !== 200, `a second cross-entity pairing for the same (peer principal, kind line) -> ${dup.status}`);
  const r1 = await rel(), e1 = await deliver(ctx, r1);
  expect(e1, 'admitted under the live pairing');
  if (e1) expect(e1.projection.basis === 'pairing' && e1.projection.paired === true && e1.projection.offer_match === false && e1.projection.auto_connect === false, `projection basis ${e1.projection.basis}, paired ${e1.projection.paired}, offer_match ${e1.projection.offer_match}, auto_connect ${e1.projection.auto_connect}`);
  expect(!await sawInvite(o1, r1.sid), 'routed to an endpoint of an app the pairing does not cover');
  const wrongPrincipal = await rel({from: mallory}); await w.peer.post(wrongPrincipal.batch);
  const wrongKind = await invite(ctx, {basis: {relation: 'pairing'}}); await w.peer.post(wrongKind.batch);
  expect(!await delivered(ctx, wrongPrincipal.sid), 'admitted for a principal the pairing does not name');
  expect(!ctx.has(e => e.type === 'invite' && e.sid === wrongKind.sid), 'admitted for a kind line the pairing does not name');
  // Initiator side (§5.1 item 7).
  const openRel = async (c, ep, to) => c.call('open', {...ep, to, kind: PAIR_LINE, profile: 'data', params: {}, delegate: (await keyPair()).jwk, basis: {relation: 'pairing'}});
  const own = await openRel(ctx.c, ctx.ep, ctx.bob.principal), notCovered = await openRel(other, o1.ep, ctx.bob.principal), noPairing = await openRel(ctx.c, ctx.ep, mallory.principal);
  expect(own.result?.certificate, `open relation by the covered app: ${JSON.stringify(own.error)}`);
  expect(errorCode(notCovered) === 'invalid_args', `open relation by an app the pairing does not cover: ${notCovered.result ? 'certified' : errorCode(notCovered)}`);
  expect(errorCode(noPairing) === 'invalid_args', `open relation with no pairing for that principal: ${noPairing.result ? 'certified' : errorCode(noPairing)}`);
  // Removal: a claimed session gets a control statement `revoked`; a pending invite ends silently.
  let claimed = null; if (e1) claimed = await accept(ctx, r1);
  const r2 = await rel(); assert.ok(await deliver(ctx, r2), 'a second relation invite pending');
  const rm = await ctx.owner('pairing-remove', {id: p.body.id}); assert.equal(rm.status, 200, 'pairing removal');
  expect(await ctx.waitEvent(e => e.sid === r2.sid && e.type === 'state' && e.state === 'ended', 4000), 'removal ended the pending invite at the endpoint');
  expect(await ctx.waitEvent(e => e.type === 'pairing' && e.sid === null && e.pairing?.id === p.body.id && e.pairing?.state === 'deleted', 3000), 'no pairing event with state deleted reached the covered endpoint (§10.3)');
  expect(!o1.has(e => e.type === 'pairing'), 'a pairing event reached an endpoint the pairing does not cover');
  if (claimed) {
    const ctl = await w.peer.until(() => w.peer.controls(r1.sid).find(c => c.payload.reason === 'revoked'), {timeout: 6000});
    expect(ctl, 'removal sent a control statement revoked for the claimed session');
  }
  await sleep(500);
  expect(!peerSaw([r2.sid]).length, 'the pending invite\'s end reached the initiator provider');
  const r3 = await rel(); await w.peer.post(r3.batch);
  expect(!await delivered(ctx, r3.sid), 'admitted after the pairing was removed');
  if (wrong.length) diverge(t, {section: '§5.1 item 7, §5.2 relation basis, §5.4 case 4, §5.8 ("Cross-entity pairing is the relation basis"; Revocation and clearing), §8.5, §10.3 paired', request: 'relation-basis invites and opens before, under and after a live cross-entity pairing', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

test('§5.8 pairing state and opens: a pending pairing admits nothing until activated; opens decides which side may open at both providers; a principal block deletes the pairing and unblocking does not restore it', async t => {
  const {wrong, expect} = checks();
  const openRel = async ctx => ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, kind: PAIR_LINE, profile: 'data', params: {}, delegate: (await keyPair()).jwk, basis: {relation: 'pairing'}});
  const rel = ctx => invite(ctx, {kind: REF[PAIR_LINE], profile: 'data', basis: {relation: 'pairing'}});
  // A: pending (opens: peer), then activated.
  const a = await callee({kinds: [LINE, PAIR_LINE]}); await beacon(a);
  const pa = await pair(a.acct, {principal: a.bob.principal, opens: 'peer', activate: false}); assert.equal(pa.status, 200, JSON.stringify(pa.body));
  expect(pa.body.state === 'pending', `created with activate:false -> ${pa.body.state}`);
  const pend = await rel(a); await w.peer.post(pend.batch);
  expect(!await delivered(a, pend.sid), 'a pending pairing admitted a relation invite');
  const [act] = await w.widen(a.acct, [{action: 'pairing-activate', input: {id: pa.body.id, revision: pa.body.revision}}]); expect(act.status === 200, `activation -> ${act.status} ${await act.clone().text()}`);
  expect(await deliver(a, await rel(a)), 'the activated pairing (opens: peer) did not admit the peer\'s invite');
  const aOpen = await openRel(a);
  expect(errorCode(aOpen) === 'invalid_args', `open relation on the side that may not open (opens: peer): ${aOpen.result ? 'certified' : errorCode(aOpen)}`);
  // B: opens local; then a principal block deletes it.
  const b = await callee({kinds: [LINE, PAIR_LINE]}); await beacon(b);
  const pb = await pair(b.acct, {principal: b.bob.principal, opens: 'local'}); assert.equal(pb.status, 200, JSON.stringify(pb.body));
  const bIn = await rel(b); await w.peer.post(bIn.batch);
  expect(!await delivered(b, bIn.sid), 'opens: local admitted the peer\'s invite');
  const bOpen = await openRel(b);
  expect(bOpen.result?.certificate, `open relation on the opening side (opens: local): ${JSON.stringify(bOpen.error)}`);
  await b.owner('block', {principal: b.bob.principal}); await b.owner('unblock', {principal: b.bob.principal});
  const settings = await (await w.request('/api/signaling/settings', b.acct.owner)).json();
  expect(!(settings.pairings ?? []).some(x => x.id === pb.body.id), 'the pairing survived a block of its peer principal (or was restored by unblocking)');
  const after = await openRel(b);
  expect(errorCode(after) === 'invalid_args', `open relation after the block deleted the pairing: ${after.result ? 'certified' : errorCode(after)}`);
  if (wrong.length) diverge(t, {section: '§5.8 ("Pending and explicit activation (P3)", `opens`, Revocation and clearing), §5.1 item 7, §13.2 Pairings', request: 'pending then activated (opens: peer); opens: local; block then unblock of the peer principal', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

// ==== §3.4 bases enforcement =========================================================================================
test('§3.4/§5.1 item 6/§5.2 bases: offer, open and pairing creation refuse a basis the kind does not list, and the recipient admits nothing outside the kind\'s bases', async t => {
  const ctx = await callee({kinds: [LINE, PAIR_LINE, OFFER_LINE]}); await beacon(ctx);
  const {wrong, expect} = checks(), leg = async () => (await keyPair()).jwk;
  const answers = {
    'offer for a kind without the offer basis': await ctx.c.call('offer', {...ctx.ep, kind: PAIR_LINE, profile: 'data', expires_in: 600}),
    'open with an offer basis for a kind without it': await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, kind: PAIR_LINE, profile: 'data', params: {}, delegate: await leg(), basis: {offer: w.peer.mintOffer()}}),
    'open with a relation basis for a kind without the pairing basis': await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, kind: OFFER_LINE, profile: 'data', params: {}, delegate: await leg(), basis: {relation: 'pairing'}}),
    'open of a cross-entity invite with no basis': await ctx.c.call('open', {...ctx.ep, to: ctx.bob.principal, kind: LINE, profile: 'webrtc', params: {offer: null}, delegate: await leg()})
  };
  for (const [name, r] of Object.entries(answers)) { t.diagnostic(`${name} -> ${JSON.stringify(r.error ?? 'success')}`); expect(errorCode(r) === 'invalid_args', `${name}: ${r.result ? 'succeeded' : errorCode(r)}`); }
  const pc = await pair(ctx.acct, {line: OFFER_LINE, principal: ctx.bob.principal});
  expect(pc.status !== 200, `pairing creation for a kind without the pairing basis -> ${pc.status}`);
  // Recipient: an offer-basis invite for PAIR_LINE carrying a live offer's token admits nothing; the matching offer
  // invite on OFFER_LINE is admitted (control).
  const live = (await ctx.mint({kind: OFFER_LINE, profile: 'data', uses: 4})).offers[0].offer;
  const outside = await invite(ctx, {kind: REF[PAIR_LINE], profile: 'data', token: live}); await w.peer.post(outside.batch);
  const relOutside = await invite(ctx, {kind: REF[OFFER_LINE], profile: 'data', basis: {relation: 'pairing'}}); await w.peer.post(relOutside.batch);
  expect(!await delivered(ctx, outside.sid), 'an offer-basis invite for a kind whose bases exclude offer was admitted');
  expect(!ctx.has(e => e.type === 'invite' && e.sid === relOutside.sid), 'a relation-basis invite for a kind whose bases exclude pairing was admitted');
  expect(await deliver(ctx, await invite(ctx, {kind: REF[OFFER_LINE], profile: 'data', token: live})), 'the offer-basis invite on the offer-only kind was not admitted (control)');
  t.diagnostic('the recipient-side bases check is observable only as "admits nothing": no record can exist for a basis the kind excludes (offer and pairing creation refuse it), so a separate step-7 drop cannot be told apart from a missing record');
  if (wrong.length) diverge(t, {section: '§3.4 bases ("Both providers enforce it"), §5.1 items 6 and 7, §5.2 ("Kind bases"), §5.7 Minting, §5.8 Creation', request: 'offer, open and pairing creation outside the kind\'s bases; recipient invites outside them', observed: wrong.join('; '), expected: 'refused with invalid_args; nothing admitted', side: 'implementation'});
});

// ==== §8.3 glare =====================================================================================================
test('§8.3 glare: crossing relation-basis invites are both delivered and never auto-claimed; both endpoints rank them alike from the initiator leg keys; the loser cancels and the survivor connects', async t => {
  const ctx = await callee({kinds: [LINE, PAIR_LINE]}); await beacon(ctx);
  const {wrong, expect} = checks(), a1 = await ctx.register([PAIR_LINE]);
  const p = await pair(ctx.acct, {principal: ctx.bob.principal, opens: 'both'}); assert.equal(p.status, 200, JSON.stringify(p.body));
  // The provider-side endpoint opens to bob ...
  const appLeg = await keyPair(), o = await a1.c.call('open', {...a1.ep, to: ctx.bob.principal, kind: PAIR_LINE, profile: 'data', params: {}, delegate: appLeg.jwk, basis: {relation: 'pairing'}});
  assert.ok(o.result?.certificate, 'open relation: ' + JSON.stringify(o.error));
  const A = {sid: o.result.sid ?? part(o.result.certificate, 1).sid, cert: o.result.certificate, appLeg, peerIdentity: ctx.bob.identity, appSeq: 0};
  A.invite = await appMessage(ctx, A, {seq: A.appSeq++, type: 'invite', to: null, body: {kind: REF[PAIR_LINE], profile: 'data', answer_by: now() + 100, basis: {relation: 'pairing'}, context: null, params: {}}});
  assert.equal((await a1.c.call('send', {...a1.ep, sid: A.sid, messages: [A.invite]})).result?.accepted, 1);
  assert.ok(await w.peer.until(() => w.peer.messages(A.sid).some(m => m.jws === A.invite)), 'the provider\'s invite reached the peer');
  // ... while bob opens to the provider entity for the same kind line.
  const B = await invite(ctx, {kind: REF[PAIR_LINE], profile: 'data', basis: {relation: 'pairing'}}), e = await deliver(a1, B);
  expect(e, 'the crossing invite was not delivered to the endpoint holding the outgoing session');
  if (!e) { diverge(t, {section: '§8.3', request: 'crossing relation-basis invites', observed: wrong.join('; '), expected: 'both delivered', side: 'implementation'}); return; }
  expect(e.projection.paired === true, `crossing pairing invite projected paired ${e.projection.paired} (claimable under the pairing, §8.3)`);
  await sleep(800);
  expect(!w.peer.messages(B.sid).some(m => ['accept', 'decline'].includes(m.payload.type)), 'the provider claimed the crossing invite on its own');
  expect(!a1.has(x => x.sid === B.sid && x.type === 'state'), 'the crossing invite changed state without a claim');
  // Each side ranks the two sessions from its own verified view of the two initiator leg certificates.
  const aFromPeer = part(w.peer.certificates(A.sid).find(c => c.payload.role === 'initiator').jws, 1).cnf.jkt, bAtPeer = B.leg.jkt;
  const aAtEndpoint = part(A.cert, 1).cnf.jkt, bFromEndpoint = part(e.certificate, 1).cnf.jkt;
  expect(aFromPeer === aAtEndpoint && bAtPeer === bFromEndpoint, 'the two sides hold different initiator leg keys');
  const peerView = await glareOutcome(aFromPeer, bAtPeer), endpointView = await glareOutcome(bFromEndpoint, aAtEndpoint);
  const peerSurvivor = peerView === 'a' ? A.sid : peerView === 'b' ? B.sid : null, endpointSurvivor = endpointView === 'a' ? B.sid : endpointView === 'b' ? A.sid : null;
  expect(peerSurvivor === endpointSurvivor, 'the two endpoints disagree on the surviving session');
  const ranks = await glareRanks(aFromPeer, bAtPeer), swapped = await glareRanks(bAtPeer, aFromPeer);
  expect(b64(ranks.a) === b64(swapped.b) && b64(ranks.b) === b64(swapped.a), 'the ranks depend on which side computes them');
  // The implementation's endpoint rule against the clean-room ranks, including the equal-rank case.
  const implOutcome = await glareSurvivor(aFromPeer, bAtPeer);
  expect(implOutcome === peerView, `packages/signaling/sessions.mjs glareSurvivor -> ${implOutcome}, clean-room -> ${peerView}`);
  const same = (await keyPair()).jkt;
  expect(await glareOutcome(same, same) === 'both-cancel' && await glareSurvivor(same, same) === 'both-cancel', 'equal ranks do not cancel both sessions');
  let disagreements = 0; for (let i = 0; i < 16; i++) { const x = (await keyPair()).jkt, y = (await keyPair()).jkt; if (await glareSurvivor(x, y) !== await glareOutcome(x, y)) disagreements++; }
  expect(!disagreements, `glareSurvivor disagreed with the clean-room ranks on ${disagreements} of 16 random key pairs`);
  t.diagnostic(`surviving session: ${peerSurvivor === A.sid ? 'the provider endpoint\'s' : 'the peer\'s'} (ranks ${b64(ranks.a).slice(0, 8)}… / ${b64(ranks.b).slice(0, 8)}…)`);
  // Resolution: the endpoint whose outgoing session ranks higher cancels it; the survivor is claimed and connects.
  if (peerSurvivor === A.sid) {
    await cancel(ctx, B);
    expect(await a1.waitEvent(x => x.sid === B.sid && x.type === 'state' && x.state === 'ended', 4000), 'the peer\'s cancel ended its losing invite at the endpoint');
    const leg = await keyPair(), cert = await w.peer.legCertificate({sub: ctx.bob.sub, aud: ctx.acct.identity, sid: A.sid, role: 'recipient', kind: REF[PAIR_LINE], profile: 'data', leg});
    const acc = await w.peer.message({leg, sub: ctx.bob.sub, aud: ctx.acct.identity, sid: A.sid, to: appLeg.jkt, seq: 0, type: 'accept', body: {params: {}}});
    await w.peer.post(w.peer.batch({certificates: [cert], messages: [acc]}));
    expect(await a1.waitEvent(x => x.message === acc, 5000), 'the surviving session\'s accept reached the provider endpoint');
  } else if (peerSurvivor === B.sid) {
    const c = await appMessage(ctx, A, {seq: A.appSeq++, type: 'cancel', to: null, body: {}});
    expect((await a1.c.call('send', {...a1.ep, sid: A.sid, messages: [c]})).result?.accepted === 1, 'the endpoint cancelled its losing session');
    expect(await w.peer.until(() => w.peer.messages(A.sid).some(m => m.jws === c), {timeout: 4000}), 'the cancel reached the peer');
    await accept(ctx, B, a1);
  }
  if (wrong.length) diverge(t, {section: '§8.3 Glare (pairing invites crossing; ranks from the initiator leg keys; "Glare decides only which session survives"), §5.5 (no claim by the provider)', request: 'a provider endpoint and a peer opening relation-basis sessions to each other at once', observed: wrong.join('; '), expected: 'as listed in the spec', side: 'implementation'});
});

