// An offline, stateful stand-in for the Polar SDK surface organization billing uses (pinned @polar-sh/sdk 1.0.2,
// 2026-10 API: products, checkouts, customers.getStateExternal, subscriptions get/revoke, orders list/get, refunds).
// Checkout metadata is copied to the subscription and its order, as Polar documents. Test-only: it proves local
// behaviour against this model, never provider conformance.
import {ORGANIZATION_PLANS} from '../../packages/billing/organizations.mjs';
export const ORG_POLAR_CONFIG=Object.freeze({BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline-only',POLAR_WEBHOOK_SECRET:'whsec_offline',POLAR_METADATA_PREFIX:'3sln_me_',APP_ORIGIN:'https://3sln.example',
 POLAR_PRODUCT_ID_ORG_TEAM:'org-team-product',POLAR_PRODUCT_ID_ORG_BUSINESS:'org-business-product',POLAR_PRODUCT_ID_ORG_SCALE:'org-scale-product'});
const productId={'org-team':'org-team-product','org-business':'org-business-product','org-scale':'org-scale-product'};
export function fakeOrgPolar({clock,organizationId='polar-org'}={}){
 let n=0;const id=prefix=>`${prefix}_${++n}`,iso=ms=>new Date(ms).toISOString(),now=()=>clock.now();
 const products=Object.fromEntries(Object.entries(productId).map(([plan,pid])=>[pid,{id:pid,name:ORGANIZATION_PLANS[plan].name,organization_id:organizationId,is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,metadata:{},
  prices:[{id:pid+'-usd',product_id:pid,source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:ORGANIZATION_PLANS[plan].annualAmount},{id:pid+'-eur',product_id:pid,source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'eur',price_amount:ORGANIZATION_PLANS[plan].annualAmount}]}]));
 const customers=new Map(),subscriptions=new Map(),orders=new Map(),checkouts=new Map(),calls=[],effects={revoked:[],refunds:[]};
 const customerFor=external=>{if(!customers.has(external))customers.set(external,{id:id('cus'),external_id:external,organization_id:organizationId,deleted_at:null});return customers.get(external);};
 const view=s=>{const c=[...customers.values()].find(x=>x.id===s.customer_id);return structuredClone({...s,customer:{id:c.id,external_id:c.external_id,organization_id:c.organization_id}});};
 const client={
  products:{get:async pid=>{calls.push(['products.get',pid]);if(!products[pid])throw Object.assign(Error('missing'),{statusCode:404});return structuredClone(products[pid]);},list:async()=>({items:Object.values(products).map(p=>structuredClone(p)),pagination:{total_count:Object.keys(products).length,max_page:1}})},
  checkouts:{create:async body=>{calls.push(['checkouts.create',body]);const product=products[body.products[0]],price=product.prices.find(p=>p.price_currency===body.currency);const session={id:id('chk'),url:'https://sandbox.polar.sh/checkout/'+n,product_id:product.id,organization_id:organizationId,external_customer_id:body.external_customer_id,currency:body.currency,amount:price.price_amount,allow_discount_codes:body.allow_discount_codes,discount_amount:0,net_amount:price.price_amount,tax_amount:null,total_amount:price.price_amount,tax_behavior:'exclusive',metadata:structuredClone(body.metadata),expires_at:iso(now()+3600000)};checkouts.set(session.id,session);return structuredClone(session);}},
  customers:{getStateExternal:async external=>{calls.push(['customers.state',external]);const c=customers.get(external);if(!c)throw Object.assign(Error('missing'),{statusCode:404});return structuredClone({...c,active_subscriptions:[...subscriptions.values()].filter(s=>s.customer_id===c.id&&['active','past_due','trialing'].includes(s.status)).map(s=>({id:s.id,product_id:s.product_id}))});}},
  subscriptions:{get:async sid=>{calls.push(['subscriptions.get',sid]);const s=subscriptions.get(sid);if(!s)throw Object.assign(Error('missing'),{statusCode:404});return view(s);},
   revoke:async sid=>{calls.push(['subscriptions.revoke',sid]);const s=subscriptions.get(sid);s.status='canceled';s.cancel_at_period_end=false;s.ended_at=iso(now());effects.revoked.push(sid);return view(s);}},
  orders:{list:async({subscription_id})=>{calls.push(['orders.list',subscription_id]);return {items:[...orders.values()].filter(o=>o.subscription_id===subscription_id).map(o=>structuredClone(o)),pagination:{total_count:0,max_page:1}};},
   get:async oid=>{calls.push(['orders.get',oid]);const o=orders.get(oid);if(!o)throw Object.assign(Error('missing'),{statusCode:404});const c=[...customers.values()].find(x=>x.id===o.customer_id);return structuredClone({...o,customer:{external_id:c.external_id,organization_id:organizationId}});}},
  refunds:{create:async body=>{calls.push(['refunds.create',body]);const o=orders.get(body.order_id);if(!Number.isSafeInteger(body.amount)||body.amount<1||o.refunded_amount+body.amount>o.net_amount)throw Object.assign(Error('refund exceeds the order'),{statusCode:400});o.refunded_amount+=body.amount;o.status=o.refunded_amount>=o.net_amount?'refunded':'partially_refunded';effects.refunds.push({order:o.id,subscription:o.subscription_id,amount:body.amount});return {id:id('ref'),order_id:o.id,amount:body.amount};}}
 };
 /** Completes a checkout: a subscription carrying the checkout's metadata and a captured first order. */
 function pay(checkoutId,{status='active',paid=true}={}){
  const k=checkouts.get(checkoutId);if(!k)throw Error('unknown checkout '+checkoutId);const c=customerFor(k.external_customer_id),start=now();
  const s={id:id('sub'),customer_id:c.id,product_id:k.product_id,metadata:structuredClone(k.metadata),recurring_interval:'year',recurring_interval_count:1,currency:k.currency,amount:k.amount,status,current_period_start:iso(start),current_period_end:iso(start+365*86400000),ends_at:null,ended_at:null,cancel_at_period_end:false};
  subscriptions.set(s.id,s);const o={id:id('ord'),subscription_id:s.id,product_id:s.product_id,customer_id:c.id,currency:s.currency,status:paid?'paid':'pending',paid,net_amount:s.amount,tax_amount:0,total_amount:s.amount,refunded_amount:0,metadata:structuredClone(k.metadata),created_at:iso(start)};orders.set(o.id,o);return {subscription:s.id,order:o.id};
 }
 /** A direct subscription for setup (as if created by an earlier checkout). */
 function subscribe({org,owner,plan='org-team',purpose='create',binding,prefix='3sln_me_',currency='usd'}){const session={id:id('chk'),product_id:productId[plan],external_customer_id:org,currency,amount:products[productId[plan]].prices.find(p=>p.price_currency===currency&&!p.is_archived).price_amount,metadata:{[prefix+'org_owner']:owner,[prefix+'org_purpose']:purpose,[prefix+'org_binding']:binding,[prefix+'org']:org}};checkouts.set(session.id,session);return pay(session.id);}
 function lapse(sid,{status='canceled'}={}){const s=subscriptions.get(sid);s.status=status;if(status==='canceled'){s.ended_at=iso(now());s.cancel_at_period_end=false;}}
 function checkoutBy(predicate){return [...checkouts.values()].filter(predicate).at(-1);}
 return {client,pay,subscribe,lapse,checkouts,subscriptions,orders,customers,products,calls,effects,checkoutBy};
}
