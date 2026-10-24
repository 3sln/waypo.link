// Wargame 2026-10-23 B1: an unpaid upgrade attempt must not freeze a funded over-quota cutoff, and any billing pause of
// retention is bounded (RETENTION_BOUNDS.billingPauseMs), after which the last authoritative state applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {fakeClock} from './helpers/chaos.mjs';
import {BillingService} from '../packages/billing/service.mjs';
import {BILLING_PLANS,BILLING_STATE_KEY} from '../packages/billing/catalog.mjs';
import {ProduceRetention,RETENTION_BOUNDS,RETENTION_LEDGER} from '../packages/runtime/retention.mjs';
import {OVER_QUOTA_EPISODE} from '../packages/runtime/export-hooks.mjs';
const DAY=86400000,HOUR=3600000,config={APP_ORIGIN:'https://retention.example',OVER_QUOTA_RETENTION_ENABLED:'true',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product'};
const txId='00000000-0000-4000-8000-000000000001';
async function world(){
 const clock=fakeClock(),start=clock.now(),f=await createTestEngine({clock,config});await f.metadata.put('owner',OWNER);
 const customer={id:'customer',external_id:OWNER,organization_id:'org',active_subscriptions:[{id:'subscription'}]},subscription={id:'subscription',customer_id:'customer',customer,product_id:'plus-product',amount:3500,currency:'usd',status:'active',recurring_interval:'year',recurring_interval_count:1,current_period_start:new Date(start-DAY).toISOString(),current_period_end:new Date(start+365*DAY).toISOString(),cancel_at_period_end:false,ended_at:null,pending_update:null};
 const products=['paid','plus','ultra'].map(plan=>({id:plan+'-product',organization_id:'org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,prices:[{id:plan+'-price',product_id:plan+'-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:BILLING_PLANS[plan].annualAmount}]}));
 const client={products:{get:async id=>structuredClone(products.find(p=>p.id===id))},customers:{getStateExternal:async()=>structuredClone(customer)},subscriptions:{get:async()=>structuredClone(subscription),update:async(id,args)=>{subscription.product_id=args.product_id;subscription.amount=products.find(p=>p.id===args.product_id).prices[0].price_amount;return structuredClone(subscription);}},orders:{list:async()=>({items:[],pagination:{total_count:0}})}};
 const billing=new BillingService({config,metadata:f.metadata,client,now:clock.now});
 const produce=()=>f.perform(new ProduceRetention({actor:{kind:'system',owner:OWNER}})),episode=()=>f.metadata.get(OVER_QUOTA_EPISODE);
 await f.metadata.put('resource/r',{id:'r',owner:OWNER,provider:'hosted'});await f.metadata.put('hosted/r/o',{size:6000000000});await f.metadata.put('hosted-usage',{bytes:6000000000,objects:1});
 await billing.reconcile(OWNER);
 // Verified Plus -> Paid downgrade with 6 GB stored: a 30-day funded cutoff starts.
 Object.assign(subscription,{product_id:'paid-product',amount:500,modified_at:new Date(start).toISOString()});
 await billing.applyWebhook({owner:OWNER,id:'evt-down',bodyHash:'a'.repeat(64),type:'subscription.updated',eventTimestamp:start});await produce();
 return {f,clock,start,billing,subscription,produce,episode};
}
const revoke=async w=>{Object.assign(w.subscription,{status:'revoked',ended_at:new Date(w.clock.now()).toISOString(),modified_at:new Date(w.clock.now()).toISOString()});await w.billing.applyWebhook({owner:OWNER,id:'evt-rv',bodyHash:'c'.repeat(64),type:'subscription.revoked',eventTimestamp:w.clock.now()});};

test('B1: an unpaid upgrade attempt cannot freeze a funded over-quota cutoff indefinitely',async()=>{
 const w=await world();try{
  const e0=await w.episode();assert.equal(e0.state,'grace');assert.equal(e0.deadlineAt,w.start+30*DAY);
  // Paid -> Plus; the proration invoice is declined, the subscription goes past_due on the Plus product.
  w.clock.advance(DAY);await w.billing.reconcile(OWNER);
  const quote=(await w.billing.status(OWNER)).plans.find(p=>p.id==='plus').priceDigest;
  await w.billing.changes.change(OWNER,{plan:'plus',txId,priceDigest:quote});
  w.clock.advance(20*60000);w.subscription.status='past_due';
  await w.billing.applyWebhook({owner:OWNER,id:'evt-pd',bodyHash:'b'.repeat(64),type:'subscription.past_due',eventTimestamp:w.clock.now()});
  // While the upgrade is pending and unpaid, retention runs on the source plan instead of pausing.
  await w.produce();assert.notEqual((await w.episode()).state,'paused-safety');
  w.clock.advance(10*DAY);await revoke(w);
  // Revocation yields authoritative lapse evidence at once; nothing waits for the billing-pause bound.
  w.clock.advance(HOUR);await w.produce();assert.notEqual((await w.episode()).state,'paused-safety');
  for(let i=0;i<30;i++){w.clock.advance(DAY);await w.produce();}
  const e=await w.episode();
  assert.notEqual(e.state,'paused-safety',`episode frozen: ${e.state}/${e.pauseReason}`);
  assert.equal(e.state,'cleanup-eligible');assert.equal(e.deadlineAt,w.start+30*DAY,'the funded cutoff is unchanged');
 }finally{await w.f.dispose();}
});

test('B1 control: without the upgrade attempt the same revocation reaches cleanup-eligible',async()=>{
 const w=await world();try{
  w.clock.advance(11*DAY);await revoke(w);
  for(let i=0;i<30;i++){w.clock.advance(DAY);await w.produce();}
  assert.equal((await w.episode()).state,'cleanup-eligible');
 }finally{await w.f.dispose();}
});

test('B1: a billing pause of retention is bounded; the episode then proceeds on the last authoritative state',async()=>{
 const w=await world();try{
  const last=(await w.f.metadata.get(RETENTION_LEDGER)).lastAuthoritative;assert.equal(last.plan,'paid');assert.equal(last.storageBytes,BILLING_PLANS.paid.storageBytes);
  // Billing becomes non-authoritative and stays that way (provider outage, unverifiable catalog, ...).
  const state=await w.f.metadata.get(BILLING_STATE_KEY);await w.f.metadata.put(BILLING_STATE_KEY,{...state,retentionAuthoritative:false});
  w.clock.advance(HOUR);let result=await w.produce();assert.equal(result.paused,true);assert.equal((await w.episode()).state,'paused-safety');
  const since=(await w.f.metadata.get(RETENTION_LEDGER)).billingPausedSince;
  // Readings every six hours keep the step-capped observation equal to the clock.
  const step=6*HOUR,steps=RETENTION_BOUNDS.billingPauseMs/step;
  for(let i=1;i<steps;i++){w.clock.advance(step);result=await w.produce();assert.equal(result.paused,true,'inside the bound the pause holds');assert.equal((await w.episode()).state,'paused-safety');}
  w.clock.advance(step);result=await w.produce();assert.notEqual(result.paused,true);
  assert.deepEqual(result.alerts.map(a=>a.reason),['billing-pause-bound']);assert.equal((await w.f.metadata.get(RETENTION_LEDGER)).billingPausedSince,since);
  for(let i=0;i<30;i++){w.clock.advance(DAY);result=await w.produce();assert.equal(result.alerts.length,0,'the bound alert is raised once per pause');}
  const e=await w.episode();assert.equal(e.state,'cleanup-eligible');assert.equal(e.quotaBytes,BILLING_PLANS.paid.storageBytes);
  // Authoritative billing again clears the pause bookkeeping.
  await w.f.metadata.put(BILLING_STATE_KEY,state);await w.produce();const ledger=await w.f.metadata.get(RETENTION_LEDGER);assert.equal(ledger.billingPausedSince,undefined);assert.equal(ledger.billingPauseBounded,undefined);
 }finally{await w.f.dispose();}
});
