// A fake Polar for the redirect extension (packages/billing/redirect-extension.mjs) over any identity repository, for
// the redirect-management and reminder tests. Orders follow Polar's shape as tests/billing-redirect-extension.test.mjs
// models it; refunds are recorded. Sandbox semantics only; nothing here claims provider conformance.
import { RedirectExtensionService } from '../../packages/billing/redirect-extension.mjs';

export const REDIRECT_ID = 'opaque_redirect_identifier_123';
export function fakePolar({ clock, owner }) {
  const metadata = { '3sln_me_redirect_id': REDIRECT_ID, '3sln_me_redirect_owner': owner };
  const product = { id: 'redirect-product', organization_id: 'org', is_archived: false, is_recurring: false, recurring_interval: null, prices: [{ id: 'price', product_id: 'redirect-product', is_archived: false, source: 'catalog', amount_type: 'fixed', price_currency: 'usd', price_amount: 1000 }] };
  const orders = new Map(), refunds = [];
  const add = (id, extra = {}) => { const order = { id, product_id: product.id, customer: { organization_id: 'org' }, metadata, subscription_id: null, currency: 'usd', subtotal_amount: 1000, discount_amount: 0, net_amount: 1000, tax_amount: 0, total_amount: 1000, refunded_amount: 0, paid: true, status: 'paid', created_at: new Date(clock.now()).toISOString(), ...extra }; orders.set(id, order); return order; };
  const client = {
    products: { get: async () => structuredClone(product) },
    orders: { get: async id => structuredClone(orders.get(id)) },
    refunds: { create: async body => { const o = orders.get(body.order_id); if (!o || o.refunded_amount + body.amount > o.net_amount) throw Object.assign(Error('refund exceeds the order'), { statusCode: 400 }); o.refunded_amount += body.amount; o.status = o.refunded_amount >= o.net_amount ? 'refunded' : 'partially_refunded'; refunds.push({ order: o.id, amount: body.amount, reason: body.reason }); return { id: 'refund_' + refunds.length, order_id: o.id, amount: body.amount }; } },
    checkouts: { create: async () => { throw new Error('unused'); } },
  };
  return { client, orders, refunds, add, event: (orderId, type = 'order.paid') => ({ type, orderId, redirectId: REDIRECT_ID, owner }) };
}
export function extensionService({ repository, clock, polar, due, owner }) {
  const config = { APP_ORIGIN: 'https://a.example', BILLING_ENABLED: 'true', POLAR_SERVER: 'sandbox', POLAR_ACCESS_TOKEN: 'offline', POLAR_WEBHOOK_SECRET: 'offline', POLAR_PRODUCT_ID_REDIRECT_10Y: 'redirect-product', POLAR_ORGANIZATION_ID: 'org' };
  const finder = { get: id => repository.get(id), compareAndSwap: (...args) => repository.compareAndSwap(...args), findMovedByRedirectId: async key => { const row = await repository.get(owner); return row?.moved?.redirectId === key ? row : null; } };
  return new RedirectExtensionService({ config, repository: finder, client: polar.client, now: clock.now, enabled: () => true, dueIndex: due });
}
