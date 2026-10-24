// Seeded chaos across redirect end, retarget, extension purchases (with Polar redelivery), the expiry reminder and
// expiry itself, over one moved tombstone with a scheduler interleaving every repository read and write.
// Deterministic: CHAOS_SEED moves the seed range; failing seeds are reported by forEachSeed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { managementFixture, C, DAY } from './helpers/redirect-management.mjs';
import { fakePolar, extensionService, REDIRECT_ID } from './helpers/redirect-billing.mjs';
import { redirectRecordsPort, orderDigest } from '../packages/identity/redirect-records.mjs';
import { transferIdentityPort } from '../packages/identity/transfer-out.mjs';
import { movedWindow } from '../packages/identity/lifecycle-tombstone.mjs';
import { forEachSeed, createScheduler } from './helpers/chaos.mjs';

test('chaos: end, retarget, extension, reminder and expiry keep the redirect, billing and reminder invariants', async () => {
  await forEachSeed(24, async random => {
    const fx = await managementFixture();
    await fx.world.move(fx.id, fx.hosts[fx.world.providers.get('https://b.example').origin], fx.hosts[C]);
    const row = fx.repository.rows.get(fx.id.sub); row.moved.redirectId = REDIRECT_ID;
    const originalBase = row.moved.redirectBase, retargetBase = `${C}/from/a/`, sub = fx.id.sub;
    fx.signedInAt(fx.hosts[C]);
    const verified = await fx.service.verify(fx.token);
    // When the interleaving happens: early, inside the reminder window, or just after expiry.
    const phase = random.pick(['early', 'reminder', 'expired']);
    fx.clock.advance({ early: 10, reminder: 61, expired: 91 }[phase] * DAY);
    const scheduler = createScheduler(random), wrapped = scheduler.wrap(fx.repository, 'identity');
    fx.service.records = redirectRecordsPort(wrapped, { clock: fx.clock.now });
    const polar = fakePolar({ clock: fx.clock, owner: sub }), billing = extensionService({ repository: wrapped, clock: fx.clock, polar, owner: sub, due: { put: async () => {} } });
    const records = redirectRecordsPort(wrapped, { clock: fx.clock.now }), identity = transferIdentityPort(wrapped, { clock: fx.clock.now }), sent = [];
    const send = async input => { const live = movedWindow((await fx.repository.get(sub)).moved, fx.clock.now()).live; sent.push({ ...input, live }); return random.chance(0.7); };
    const orders = ['o1', 'o2', 'o3'].slice(0, 1 + random.int(3)); for (const id of orders) polar.add(id);
    const ending = random.chance(0.6), retargeting = random.chance(0.7);
    const tasks = [
      ...orders.flatMap(id => [() => billing.applyWebhook(polar.event(id)), ...random.chance(0.5) ? [() => billing.applyWebhook(polar.event(id))] : []]),
      () => records.remind(sub, { send }), () => records.remind(sub, { send }),
      () => identity.endMoved(sub),
      ...ending ? [() => fx.service.end(verified)] : [],
      ...retargeting ? [() => fx.service.retarget(verified, retargetBase)] : [],
    ];
    const results = await scheduler.run(random.shuffle(tasks));
    for (const result of results) if (result.status === 'rejected') assert.ok(['not_found', 'billing_conflict', 'billing_provider_unavailable', 'temporarily_unavailable'].includes(result.reason?.code), `unexpected failure ${result.reason?.code ?? result.reason}`);
    fx.service.records = fx.records;
    // Settle: Polar redelivers every event once more (a 503 above asked it to); the reminder sweep runs again.
    for (const id of orders) await billing.applyWebhook(polar.event(id)).catch(() => {});
    await redirectRecordsPort(fx.repository, { clock: fx.clock.now }).remind(sub, { send });
    const moved = (await fx.repository.get(sub)).moved, live = movedWindow(moved, fx.clock.now()).live;
    const ended = results.some(result => result.status === 'fulfilled' && result.value?.outcome === 'ended');
    // Redirect: an owner end is final; a live redirect only ever points at the attested base or the verified later host.
    const events = (moved.audit ?? []).map(entry => entry.event);
    // An end is final unless the verified owner revived it inside the settlement window (review L4); the reminder email
    // an end deleted never comes back.
    if (ended) { assert.equal(moved.reminderEmail, undefined); if (live) assert.ok(events.lastIndexOf('redirect-revived') > events.lastIndexOf('redirect-ended'), 'live after an end only through a revival'); else assert.equal(moved.retarget, undefined); }
    if (live) assert.ok([originalBase, retargetBase].includes(moved.redirectBase), `redirect base ${moved.redirectBase}`);
    if (moved.retarget) assert.equal(moved.retarget.to.iss, C);
    // Billing: no order refunded twice; every order is refunded in full exactly when it bought nothing.
    const refunded = polar.refunds.map(r => r.order), settled = moved.settledOrder ?? null;
    assert.equal(new Set(refunded).size, refunded.length, 'no order is refunded twice');
    for (const id of orders) {
      // A recorded extension later marked refunded (a stale order read raced a refund; Polar's refund event then updates
      // the record) bought nothing either.
      const recorded = moved.extensionOrder?.id === id && moved.extensionOrder.refunded !== true || settled === await orderDigest(id);
      assert.equal(refunded.includes(id), !recorded, `${id}: refunded exactly when it bought nothing (phase ${phase}) ${JSON.stringify({events:(moved.audit??[]).map(e=>e.event),ext:moved.extensionOrder,settled:!!moved.settledOrder,refunded,live})}`);
      if (refunded.includes(id)) assert.equal(polar.orders.get(id).refunded_amount, 1000);
    }
    assert.ok(orders.filter(id => moved.extensionOrder?.id === id).length <= 1, 'at most one live extension');
    // Reminder: never sent before its window or after the redirect stopped; at most one accepted send per expiry.
    for (const mail of sent) { assert.equal(mail.live, true, 'no reminder for a stopped redirect'); assert.ok(fx.clock.now() >= mail.redirectUntil - 30 * DAY, 'not before the 30-day window'); }
    assert.ok(sent.length <= 3, 'bounded attempts');
    if (phase === 'early') assert.equal(sent.length, 0);
    // Audit: address-free, bounded.
    assert.doesNotMatch(JSON.stringify(moved.audit ?? []), /@|:\/\//);
    // Expiry settles everything: after movedUntil the record keeps no address, base, email or order reference.
    fx.clock.advance(4000 * DAY);
    await transferIdentityPort(fx.repository, { clock: fx.clock.now }).endMoved(sub);
    const final = (await fx.repository.get(sub)).moved;
    assert.equal(final.ended, true);
    for (const name of ['to', 'redirectBase', 'reminderEmail', 'extensionOrder', 'retarget', 'statement', 'attestation', 'settledOrder']) assert.equal(final[name], undefined, name);
  });
});
