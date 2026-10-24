import test from 'node:test';
import assert from 'node:assert/strict';
import {BillingService,BILLING_TRANSITION_PREFIX} from '../packages/billing/service.mjs';
import {BILLING_PLANS,BILLING_STATE_KEY} from '../packages/billing/catalog.mjs';
const owner='aa111111-1111-4111-8111-111111111111',other='bb222222-2222-4222-8222-222222222222';
const secret='whsec_'+Buffer.alloc(32,39).toString('base64');
const config={BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline-only',POLAR_WEBHOOK_SECRET:secret,POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product',APP_ORIGIN:'https://3sln.example'};
class Metadata {
  constructor(){this.rows=new Map();this.tail=Promise.resolve();}
  async get(k){return structuredClone(this.rows.get(k));}
  async put(k,v){this.rows.set(k,structuredClone(v));}
  async delete(k){this.rows.delete(k);}
  async list({prefix='',limit=100000}={}){return new Map([...this.rows].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));}
  async transaction(fn){const previous=this.tail;let release;this.tail=new Promise(r=>release=r);await previous;const snapshot=structuredClone(this.rows);try{return await fn(this);}catch(e){this.rows=snapshot;throw e;}finally{release();}}
}
function fixture(){
  const now=Date.now(),metadata=new Metadata(),calls=[];
  const products=Object.fromEntries(['paid','plus','ultra'].map(plan=>{const id=config[`POLAR_PRODUCT_ID_${plan.toUpperCase()}`];return [id,{id,is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,organization_id:'org',prices:[{id:plan+'-price',product_id:id,source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:BILLING_PLANS[plan].annualAmount}]}];}));
  const customer={id:'customer',external_id:owner,organization_id:'org',deleted_at:null,active_subscriptions:[]};
  const subscription={id:'subscription',customer_id:customer.id,customer:{...customer},product_id:config.POLAR_PRODUCT_ID_PLUS,amount:3500,currency:'usd',recurring_interval:'year',recurring_interval_count:1,status:'active',current_period_start:new Date(now-1000).toISOString(),current_period_end:new Date(now+365*86400000).toISOString(),cancel_at_period_end:false,ended_at:null,ends_at:null};
  const client={products:{get:async id=>{calls.push(['product',id]);return structuredClone(products[id]);}},customers:{getStateExternal:async id=>{calls.push(['customer',id]);return structuredClone(customer);}},subscriptions:{get:async id=>{calls.push(['subscription',id]);return structuredClone(subscription);}},checkouts:{create:async body=>{calls.push(['checkout',body]);const selected=products[body.products[0]].prices.find(price=>price.price_currency===body.currency);return {url:'https://sandbox.polar.sh/checkout/test',currency:body.currency,amount:selected.price_amount,discount_amount:0,net_amount:selected.price_amount,total_amount:selected.price_amount,tax_amount:null,tax_behavior:null,allow_discount_codes:true,product_id:body.products[0],organization_id:'org',external_customer_id:body.external_customer_id};}},customerSessions:{create:async body=>{calls.push(['portal',body]);return {customer_id:customer.id,customer:structuredClone(customer),customer_portal_url:'https://sandbox.polar.sh/test/portal'};}}};
  let clock=now;return {metadata,products,customer,subscription,client,calls,now,advance:ms=>clock+=ms,service:new BillingService({config,metadata,client,now:()=>clock})};
}

const rows=f=>f.metadata.list({prefix:BILLING_TRANSITION_PREFIX});
const event=(f,id='evt_drop')=>({owner,id,type:'subscription.updated',eventTimestamp:f.now,bodyHash:'a'.repeat(64)});
async function paid(f){f.customer.active_subscriptions=[{id:'subscription'}];await f.service.reconcile(owner);}
test('retention transition commits provider effective downgrade before-image and replay receipt together',async()=>{
 const f=fixture();await paid(f);Object.assign(f.subscription,{product_id:'paid-product',amount:500,modified_at:new Date(f.now-100).toISOString()});
 await f.service.applyWebhook(event(f));const transitions=await rows(f);assert.equal(transitions.size,1);const transition=[...transitions.values()][0];
 assert.deepEqual(transition.before,{plan:'plus',storageBytes:100000000000});assert.deepEqual(transition.after,{plan:'paid',storageBytes:5000000000});assert.equal(transition.effectiveAt,f.now-100);assert.equal(transition.reason,'downgrade');assert.equal(transition.causalEventId,'evt_drop');assert.equal((await f.metadata.get(BILLING_STATE_KEY)).billingRevision,transition.revision);
 await f.service.applyWebhook(event(f));assert.equal((await rows(f)).size,1);
});
test('verified lapse uses paid-through time even when reconciliation happens late',async()=>{
 const f=fixture();await paid(f);const end=Date.parse(f.subscription.current_period_end);f.advance(366*86400000);await f.service.reconcile(owner);const transition=[...(await rows(f)).values()][0];assert.equal(transition.effectiveAt,end);assert.equal(transition.reason,'lapse');
});
test('malformed prior state and deployment fallback never create retention transitions',async()=>{
 for(const mutate of [state=>({...state,verifiedPlan:{...state.verifiedPlan,storageBytes:-1}}),state=>({...state,origin:'https://other.example'})]){
  const f=fixture();await paid(f);await f.metadata.put(BILLING_STATE_KEY,mutate(await f.metadata.get(BILLING_STATE_KEY)));f.subscription.status='revoked';f.subscription.ended_at=new Date(f.now).toISOString();await f.service.applyWebhook(event(f));assert.equal((await rows(f)).size,0);
 }
});
test('unknown products and unavailable catalog cannot turn Free fallback into a downgrade',async()=>{
 const f=fixture();await paid(f);f.subscription.product_id='unknown-product';f.subscription.amount=123;await f.service.applyWebhook(event(f));assert.equal((await rows(f)).size,0);
});
test('same-plan catalog storage reductions are distinguished from customer downgrades',async()=>{
 const f=fixture();await paid(f);f.service.catalog=async()=>({organizationId:'org',entries:{plus:{id:'plus-product',prices:{usd:{currency:'usd',amount:3500}},parameters:{id:'plus',name:'Plus',storageBytes:2000000000,activityHour:2000,activityDay:10000}}}});
 await f.service.applyWebhook(event(f));const transition=[...(await rows(f)).values()][0];assert.equal(transition.reason,'catalog');assert.equal(transition.effectiveAt,f.now);
});
test('failed transactional transition writes roll back billing state and replay receipt',async()=>{
 const f=fixture();await paid(f);const before=await f.metadata.get(BILLING_STATE_KEY);f.subscription.status='revoked';f.subscription.ended_at=new Date(f.now).toISOString();const put=f.metadata.put.bind(f.metadata);f.metadata.put=async(key,value)=>{if(key.startsWith(BILLING_TRANSITION_PREFIX))throw Error('disk failure');return put(key,value);};
 await assert.rejects(f.service.applyWebhook(event(f)),/disk failure/);assert.deepEqual(await f.metadata.get(BILLING_STATE_KEY),before);assert.equal(await f.metadata.get('billing/event/evt_drop'),undefined);assert.equal((await rows(f)).size,0);
});
test('refund causal reason and explicit provider modification time survive a service restart',async()=>{
 const f=fixture();await paid(f);Object.assign(f.subscription,{product_id:'paid-product',amount:500,modified_at:new Date(f.now-250).toISOString()});
 const restarted=new BillingService({config,metadata:f.metadata,client:f.client,now:()=>f.now});await restarted.applyWebhook({...event(f),type:'order.refunded'});
 const t=[...(await rows(f)).values()][0];assert.equal(t.reason,'refund');assert.equal(t.effectiveAt,f.now-250);assert.equal(t.after.plan,'paid');
});
test('concurrent replay creates one durable transition and receipt',async()=>{
 const f=fixture();await paid(f);Object.assign(f.subscription,{status:'revoked',ended_at:new Date(f.now).toISOString()});
 await Promise.all([f.service.applyWebhook(event(f)),f.service.applyWebhook(event(f)),f.service.applyWebhook(event(f))]);
 assert.equal((await rows(f)).size,1);assert.equal((await f.metadata.get('billing/event/evt_drop')).bodyHash,'a'.repeat(64));
});
test('reconciliation never invents an effective time for an immediate downgrade',async()=>{
 const f=fixture();await paid(f);Object.assign(f.subscription,{product_id:'paid-product',amount:500});await f.service.reconcile(owner);assert.equal((await rows(f)).size,0);
 const g=fixture();await paid(g);Object.assign(g.subscription,{product_id:'paid-product',amount:500,modified_at:new Date(g.now-100).toISOString()});await g.service.reconcile(owner);assert.equal([...(await rows(g)).values()][0].effectiveAt,g.now-100);
});
test('retention provenance distinguishes a known lapse from unknown-product Free fallback',async()=>{
 const f=fixture();await paid(f);assert.equal((await f.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,true);
 f.subscription.status='revoked';f.subscription.ended_at=new Date(f.now).toISOString();await f.service.applyWebhook(event(f));assert.equal((await f.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,true);
 f.customer.active_subscriptions=[];await f.service.reconcile(owner);assert.equal((await f.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,true);
 const g=fixture();await paid(g);g.subscription.product_id='unknown-product';g.subscription.amount=123;await g.service.reconcile(owner);assert.equal((await g.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,false);
});
test('slight provider clock skew records the transition at now instead of dropping it; larger skew is not evidence',async()=>{
 const f=fixture();await paid(f);Object.assign(f.subscription,{product_id:'paid-product',amount:500,modified_at:new Date(f.now+60000).toISOString()});await f.service.applyWebhook(event(f));
 const t=[...(await rows(f)).values()][0];assert.equal(t.effectiveAt,f.now);assert.equal(t.providerEffectiveAt,f.now+60000);assert.equal(t.reason,'downgrade');
 const g=fixture();await paid(g);Object.assign(g.subscription,{product_id:'paid-product',amount:500,modified_at:new Date(g.now+3600000).toISOString()});await g.service.applyWebhook(event(g));assert.equal((await rows(g)).size,0);
});
