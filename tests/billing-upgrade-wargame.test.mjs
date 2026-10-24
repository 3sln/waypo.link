// Wargame 2026-10-23 (DEVLOG "Billing, retention and region wargame fixes"): pending upgrades, dead change locks,
// failed proration invoices, provisional windows and paid-signup recheck. Each test fails if its fix is reverted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {BillingService,BILLING_TRANSITION_PREFIX} from '../packages/billing/service.mjs';
import {ReconcileBillingChangeLock,UPGRADE_PAST_DUE_MS,UPGRADE_GUARD_PREFIX} from '../packages/billing/changes.mjs';
import {BILLING_STATE_KEY,entitlementFromState} from '../packages/billing/catalog.mjs';
import {createTestEngine} from './helpers/app-engine.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNodeServer} from '../apps/node/server.mjs';
import {ACCOUNT_OPERATIONS} from '../packages/app/operations.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ids=['paid','plus','ultra'],DAY=86400000,LOCK='billing/change-lock';
function fixture(){let now=Date.now(),updates=0;const metadata=new SqliteMetadata(':memory:'),config={APP_ORIGIN:'https://billing.example',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product'};const products=ids.map((id,i)=>({id:id+'-product',organization_id:'org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,prices:[{id:id+'-price',product_id:id+'-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:[500,3500,25000][i]}]})),customer={id:'customer',external_id:owner,organization_id:'org',active_subscriptions:[{id:'subscription'}]},subscription={id:'subscription',customer_id:'customer',customer,product_id:'paid-product',amount:500,currency:'usd',status:'active',recurring_interval:'year',recurring_interval_count:1,current_period_start:new Date(now-1000).toISOString(),current_period_end:new Date(now+86400000).toISOString(),cancel_at_period_end:false,pending_update:null};const orders=[],gone=new Set();let uncertain=false;const client={products:{get:async id=>structuredClone(products.find(p=>p.id===id))},customers:{getStateExternal:async()=>structuredClone(customer)},orders:{list:async()=>({items:structuredClone(orders),pagination:{total_count:orders.length}})},subscriptions:{get:async id=>{if(gone.has(id)||id!==subscription.id)throw Object.assign(Error('missing'),{statusCode:404});return structuredClone(subscription);},update:async(id,args)=>{updates++;if(uncertain)throw Error('timeout');if(args.pending_update===null)subscription.pending_update=null;else if(args.proration_behavior==='next_period')subscription.pending_update={id:'schedule',product_id:args.product_id,applies_at:subscription.current_period_end};else{subscription.product_id=args.product_id;subscription.amount=products.find(p=>p.id===args.product_id).prices[0].price_amount;}return structuredClone(subscription);}}};const service=new BillingService({config,metadata,client,now:()=>now});return {metadata,config,service,subscription,customer,gone,get now(){return now;},advance:n=>now+=n,get updates(){return updates;},uncertain:value=>uncertain=value,order:(patch={})=>orders.unshift({id:'order-'+orders.length,subscription_id:'subscription',product_id:subscription.product_id,customer_id:'customer',customer,currency:'usd',billing_reason:'subscription_update',created_at:new Date(now).toISOString(),status:'paid',paid:true,subtotal_amount:0,discount_amount:0,net_amount:0,tax_amount:0,total_amount:0,applied_balance_amount:0,due_amount:0,refunded_amount:0,refunded_tax_amount:0,...patch}),close:()=>metadata.close()};}
const tx=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
async function review(f,plan){await f.service.reconcile(owner);return (await f.service.status(owner)).plans.find(p=>p.id===plan).priceDigest;}
const plan=async f=>entitlementFromState(await f.metadata.get(BILLING_STATE_KEY),f.now,f.config);
const transitions=async f=>[...(await f.metadata.list({prefix:BILLING_TRANSITION_PREFIX})).values()];
const webhook=(f,id,type)=>f.service.applyWebhook({owner,id,type,eventTimestamp:f.now,bodyHash:id.replace(/[^a-f0-9]/g,'').padEnd(64,'a').slice(0,64)});
function plus(f,periodDays=300){Object.assign(f.subscription,{product_id:'plus-product',amount:3500,current_period_end:new Date(f.now+periodDays*DAY).toISOString()});}
const revoke=f=>Object.assign(f.subscription,{status:'revoked',ended_at:new Date(f.now-1000).toISOString(),modified_at:new Date(f.now-1000).toISOString()});
// Plus subscriber starts an Ultra upgrade (invoice), never pays it, Polar revokes the subscription.
async function revokedUpgrade(f){plus(f);const r=await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});assert.equal(r.outcome,'pending');f.advance(20*DAY);revoke(f);await webhook(f,'evt_revoke','subscription.revoked');}

test('B2: revocation during an unpaid upgrade records a lapse transition against the source plan and finishes the lock',async()=>{const f=fixture();try{await revokedUpgrade(f);
 assert.equal((await plan(f)).plan,'free');
 const rows=await transitions(f);assert.equal(rows.length,1,'paid->free reduction must start a retention episode');assert.equal(rows[0].reason,'lapse');assert.equal(rows[0].after.plan,'free');
 assert.equal((await f.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,true);
 assert.equal(await f.metadata.get(LOCK),undefined);assert.equal((await f.service.changes.view(tx(1))).outcome,'ended');
}finally{f.close();}});

test('B2: revocation inside the provisional window is not hidden by the provisional before-image',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});assert.equal((await plan(f)).provisional,true);
 f.advance(5*60000);revoke(f);await webhook(f,'evt_revoke_early','subscription.revoked');
 const rows=await transitions(f);assert.equal(rows.length,1);assert.deepEqual(rows[0].before,{plan:'ultra',storageBytes:1e12});assert.equal(rows[0].after.plan,'free');
}finally{f.close();}});

test('B3: a dead upgrade lock does not wedge plan changes on a later new subscription',async()=>{const f=fixture();try{await revokedUpgrade(f);
 Object.assign(f.subscription,{id:'subscription2',status:'active',ended_at:null,product_id:'plus-product',amount:3500,current_period_start:new Date(f.now-1000).toISOString(),current_period_end:new Date(f.now+365*DAY).toISOString()});f.customer.active_subscriptions=[{id:'subscription2'}];
 await f.service.reconcile(owner);assert.equal((await f.service.status(owner)).plan,'plus');
 const result=await f.service.changes.change(owner,{plan:'ultra',txId:tx(2),priceDigest:await review(f,'ultra')});assert.equal(result.outcome,'pending');
}finally{f.close();}});

test('B3: a lock whose subscription vanished is superseded by the verified replacement subscription',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 // The provider no longer returns the old subscription at all, so its fence never runs again.
 f.gone.add('subscription');Object.assign(f.subscription,{id:'subscription2',product_id:'plus-product',amount:3500,status:'active',current_period_start:new Date(f.now-1000).toISOString(),current_period_end:new Date(f.now+365*DAY).toISOString()});f.customer.active_subscriptions=[{id:'subscription2'}];
 const result=await f.service.changes.change(owner,{plan:'ultra',txId:tx(2),priceDigest:await review(f,'ultra')});assert.equal(result.outcome,'pending');assert.equal((await f.service.changes.view(tx(1))).outcome,'superseded');
}finally{f.close();}});

test('B3/H1: a revert is finished only after two observations past GRACE, and the guard then refuses the unpaid target',async()=>{const f=fixture();try{plus(f);await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 Object.assign(f.subscription,{product_id:'plus-product',amount:3500});await f.service.reconcile(owner);
 assert.equal(await f.metadata.get(LOCK),tx(1),'a revert inside GRACE is not finished');
 f.advance(15*60000);await f.service.reconcile(owner);assert.equal(await f.metadata.get(LOCK),tx(1),'one observation past GRACE is not enough');
 f.advance(1000);await f.service.reconcile(owner);assert.equal(await f.metadata.get(LOCK),undefined);assert.equal((await f.service.changes.view(tx(1))).outcome,'reverted');assert.equal((await plan(f)).plan,'plus');
 // The provider flips back to the unpaid target: the guard holds the source plan.
 Object.assign(f.subscription,{product_id:'ultra-product',amount:25000});await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'plus','the unpaid target is never granted');
 f.order();await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'ultra','a paid target invoice lifts the guard');assert.equal(await f.metadata.get(UPGRADE_GUARD_PREFIX+'subscription'),undefined);
}finally{f.close();}});

test('H1: a single stale provider read right after acceptance neither finishes the lock nor grants the target',async()=>{const f=fixture();try{plus(f);
 const c=await f.service.client(),get=c.subscriptions.get,update=c.subscriptions.update;let stale=false;c.subscriptions.update=async(id,a)=>{const r=await update(id,a);stale=true;return r;};c.subscriptions.get=async id=>{const value=await get(id);if(stale){stale=false;return {...value,product_id:'plus-product',amount:3500};}return value;};
 const r=await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});assert.equal(r.outcome,'pending');assert.equal(await f.metadata.get(LOCK),tx(1));
 f.advance(20*60000);await f.service.reconcile(owner);const e=await plan(f);assert.equal(e.plan,'plus');assert.equal(e.provisional,undefined);
}finally{f.close();}});

test('B3/H1: an unconfirmed upgrade the provider applies late is guarded until payment',async()=>{const f=fixture();try{plus(f);const quote=await review(f,'ultra');f.uncertain(true);
 await assert.rejects(f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:quote}),{code:'indeterminate'});f.uncertain(false);Object.assign(f.subscription,{product_id:'plus-product',amount:3500});
 await f.service.reconcile(owner);assert.equal(await f.metadata.get(LOCK),tx(1),'an unconfirmed mutation still holds inside its bound');
 f.advance(15*60000);await f.service.reconcile(owner);assert.equal(await f.metadata.get(LOCK),undefined);assert.equal((await f.service.changes.view(tx(1))).outcome,'not-applied');
 Object.assign(f.subscription,{product_id:'ultra-product',amount:25000});await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'plus','a late application is not paid for');
 // A renewal on the target product is paid at renewal and lifts the guard.
 f.advance(DAY);Object.assign(f.subscription,{current_period_start:new Date(f.now-1000).toISOString(),current_period_end:new Date(f.now+365*DAY).toISOString()});await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'ultra');
}finally{f.close();}});

test('H1: an unpaid upgrade on one of two subscriptions is not released by the other one renewing',async()=>{let now=Date.now();const metadata=new SqliteMetadata(':memory:'),config={APP_ORIGIN:'https://billing.example',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product'};try{
 const products=ids.map((id,i)=>({id:id+'-product',organization_id:'org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,prices:[{id:id+'-price',product_id:id+'-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:[500,3500,25000][i]}]}));
 const customer={id:'customer',external_id:owner,organization_id:'org',active_subscriptions:[{id:'B'},{id:'A'}]},sub=(id,end)=>({id,customer_id:'customer',customer,product_id:'plus-product',amount:3500,currency:'usd',status:'active',recurring_interval:'year',recurring_interval_count:1,current_period_start:new Date(now-1000).toISOString(),current_period_end:new Date(now+end).toISOString(),cancel_at_period_end:false,pending_update:null}),subs={A:sub('A',300*DAY),B:sub('B',360*DAY)};
 const client={products:{get:async id=>structuredClone(products.find(p=>p.id===id))},customers:{getStateExternal:async()=>structuredClone(customer)},orders:{list:async()=>({items:[],pagination:{total_count:0}})},subscriptions:{get:async id=>{if(!subs[id])throw Object.assign(Error('missing'),{statusCode:404});return structuredClone(subs[id]);},update:async(id,args)=>{const v=subs[id];v.product_id=args.product_id;v.amount=products.find(p=>p.id===args.product_id).prices[0].price_amount;return structuredClone(v);}}};
 const service=new BillingService({config,metadata,client,now:()=>now}),digest=async p=>(await service.status(owner)).plans.find(x=>x.id===p).priceDigest;
 await service.reconcile(owner);const locked=(await metadata.get(BILLING_STATE_KEY)).subscriptionId,other=locked==='A'?'B':'A';
 await service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await digest('ultra')});now+=20*60000;await service.reconcile(owner);
 Object.assign(subs[other],{current_period_start:new Date(now-1000).toISOString(),current_period_end:new Date(now+400*DAY).toISOString()});await service.reconcile(owner);
 await assert.rejects(service.changes.change(owner,{plan:'paid',txId:tx(2),priceDigest:await digest('paid')}));
 assert.equal(await metadata.get(LOCK),tx(1),'an outranked but live subscription keeps its lock');
 await service.reconcile(owner);assert.notEqual(entitlementFromState(await metadata.get(BILLING_STATE_KEY),now,config).plan,'ultra','unpaid ultra granted');
}finally{metadata.close();}});

test('B1/L4: past due beyond the bound releases the lock but holds the paid-through source plan until the provider revokes',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 f.advance(DAY);Object.assign(f.subscription,{status:'past_due',modified_at:new Date(f.now).toISOString()});await webhook(f,'evt_pd','subscription.past_due');
 const held=await f.metadata.get(BILLING_STATE_KEY);assert.equal(held.plan,'plus');assert.equal(held.retentionAuthoritative,true,'a pending unpaid upgrade is authoritative at the source plan');assert.equal(await f.metadata.get(LOCK),tx(1));
 f.advance(UPGRADE_PAST_DUE_MS);await f.service.reconcile(owner);
 assert.equal(await f.metadata.get(LOCK),undefined);assert.equal((await f.service.changes.view(tx(1))).outcome,'payment-failed');
 await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'plus','the paid-through source plan is held after the lock is released');const count=(await transitions(f)).length;assert.equal((await transitions(f)).filter(row=>row.reason==='lapse').length,0,'no lapse before the provider revokes');
 revoke(f);await webhook(f,'evt_rv','subscription.revoked');assert.equal((await plan(f)).plan,'free');const rows=await transitions(f);assert.equal(rows.length,count+1);assert.equal(rows.at(-1).reason,'lapse');
}finally{f.close();}});

test('L4: a held source plan lapses with evidence at its own paid-through time',async()=>{const f=fixture();try{plus(f,40);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 f.advance(DAY);Object.assign(f.subscription,{status:'past_due'});await f.service.reconcile(owner);f.advance(40*DAY);await f.service.reconcile(owner);
 const state=await f.metadata.get(BILLING_STATE_KEY);assert.equal(entitlementFromState(state,f.now,f.config).plan,'free');assert.equal(state.retentionAuthoritative,true);
 const last=(await transitions(f)).at(-1);assert.equal(last.reason,'lapse');assert.equal(last.effectiveAt,Date.parse(f.subscription.current_period_end));
}finally{f.close();}});

test('M2: a provider revert inside or just after the provisional window is recorded as upgrade-unpaid, never catalog',async()=>{
 for(const [label,before,after] of [['inside',5*60000,0],['after',14*60000,2*60000]]){const f=fixture();try{plus(f);
  await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});const end=(await plan(f)).activationUntil;
  f.advance(before);if(after){await f.service.reconcile(owner);f.advance(after);}
  Object.assign(f.subscription,{product_id:'plus-product',amount:3500,modified_at:new Date(f.now).toISOString()});await webhook(f,'evt_rev','subscription.updated');
  const rows=await transitions(f);assert.equal(rows.length,1,label);assert.equal(rows[0].reason,'upgrade-unpaid',label);assert.deepEqual(rows[0].before,{plan:'ultra',storageBytes:1e12});assert.equal(rows[0].effectiveAt,after?end:f.now,label);
 }finally{f.close();}}
});

test('B3: operator reconcile is system-only, keeps an active unpaid upgrade held and releases a superseded lock',async()=>{const f=fixture();const engine=await createTestEngine({providers:{billing:f.service}});try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 await assert.rejects(engine.perform(new ReconcileBillingChangeLock({actor:{kind:'owner',owner}})),{code:'forbidden'});
 const system={kind:'system',owner,reason:'operator-billing-reconcile'};
 assert.deepEqual(await engine.perform(new ReconcileBillingChangeLock({actor:system})),{released:false,locked:true,txId:tx(1),reason:'provider-pending'});
 f.gone.add('subscription');Object.assign(f.subscription,{id:'subscription2',product_id:'plus-product',amount:3500,current_period_start:new Date(f.now-1000).toISOString(),current_period_end:new Date(f.now+365*DAY).toISOString()});f.customer.active_subscriptions=[{id:'subscription2'}];
 const released=await engine.perform(new ReconcileBillingChangeLock({actor:system}));assert.equal(released.released,true);assert.equal(released.reason,'superseded');assert.equal(await f.metadata.get(LOCK),undefined);
 // A lock without its journal row is released only with an explicit force.
 await f.metadata.put(LOCK,tx(9));assert.equal((await engine.perform(new ReconcileBillingChangeLock({actor:system}))).reason,'authority-missing');assert.equal(await f.metadata.get(LOCK),tx(9));
 assert.equal((await engine.perform(new ReconcileBillingChangeLock({actor:system,input:{force:true}}))).released,true);assert.equal(await f.metadata.get(LOCK),undefined);
}finally{await engine.dispose?.();f.close();}});

test('B4: a customer who pays the full Ultra renewal after a failed proration invoice keeps a paid entitlement',async()=>{const f=fixture();try{plus(f,10);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 f.order({status:'void',paid:false});f.advance(11*DAY);
 Object.assign(f.subscription,{status:'active',current_period_start:new Date(f.now-DAY).toISOString(),current_period_end:new Date(f.now+364*DAY).toISOString()});
 f.order({billing_reason:'subscription_cycle',subtotal_amount:25000,net_amount:25000,total_amount:25000,due_amount:25000});
 await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'ultra','an active, fully paid Ultra subscription must not drop to Free');assert.equal((await f.service.changes.view(tx(1))).outcome,'confirmed');
}finally{f.close();}});

test('B4: a later paid cycle invoice proves payment, but refund evidence still wins over it',async()=>{const f=fixture();try{plus(f,10);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 f.order({billing_reason:'subscription_cycle',subtotal_amount:25000,net_amount:25000,total_amount:25000,due_amount:25000});f.order({status:'refunded',paid:false,refunded_amount:1});
 await f.service.reconcile(owner);assert.equal((await f.service.changes.view(tx(1))).outcome,'pending');assert.equal((await plan(f)).plan,'plus');
}finally{f.close();}});

test('B4: a paid proration invoice after a voided one proves payment',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 f.order({status:'void',paid:false});f.advance(DAY);f.order({subtotal_amount:21000,net_amount:21000,total_amount:21000,due_amount:21000});
 await f.service.reconcile(owner);assert.equal((await f.service.changes.view(tx(1))).outcome,'confirmed');assert.equal((await plan(f)).plan,'ultra');
}finally{f.close();}});

test('B4: an active subscription renewed on the target product finishes the change even without a visible invoice',async()=>{const f=fixture();try{plus(f,10);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});f.advance(11*DAY);
 Object.assign(f.subscription,{current_period_start:new Date(f.now-DAY).toISOString(),current_period_end:new Date(f.now+364*DAY).toISOString()});
 await f.service.reconcile(owner);assert.equal((await f.service.changes.view(tx(1))).outcome,'renewed');assert.equal((await plan(f)).plan,'ultra');assert.equal(await f.metadata.get(LOCK),undefined);
}finally{f.close();}});

test('B6: an unpaid provisional window that lapses leaves an upgrade-unpaid transition for bytes admitted under it',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});
 const e=await plan(f);assert.equal(e.provisional,true);assert.equal(e.storageBytes,1e12);const end=e.activationUntil;
 f.advance(16*60000);Object.assign(f.subscription,{status:'past_due',modified_at:new Date(f.now).toISOString()});await webhook(f,'evt_pd','subscription.past_due');
 assert.equal((await plan(f)).storageBytes,1e11);
 const rows=await transitions(f);assert.equal(rows.length,1,'1 TB -> 100 GB reduction must be visible to the retention producer');assert.equal(rows[0].reason,'upgrade-unpaid');assert.equal(rows[0].effectiveAt,end);assert.deepEqual(rows[0].before,{plan:'ultra',storageBytes:1e12});
 await f.service.reconcile(owner);assert.equal((await transitions(f)).length,1,'the closed window is recorded once');
}finally{f.close();}});

test('B6: a provisional window confirmed by a paid invoice records no reduction',async()=>{const f=fixture();try{plus(f);
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await review(f,'ultra')});f.order();f.advance(16*60000);await f.service.reconcile(owner);
 assert.equal((await plan(f)).plan,'ultra');assert.equal((await transitions(f)).length,0);
}finally{f.close();}});

test('H1: a second checkout from Free is refused while one is open; the same plan and currency reopens it',async()=>{const f=fixture();try{f.customer.active_subscriptions=[];
 const c=await f.service.client();let created=0;c.checkouts={create:async args=>{created++;const amount={'paid-product':500,'plus-product':3500,'ultra-product':25000}[args.products[0]];return {url:`https://sandbox.polar.sh/checkout/${created}`,currency:args.currency,amount,product_id:args.products[0],organization_id:'org',external_customer_id:owner,allow_discount_codes:true,discount_amount:0,net_amount:amount,total_amount:amount,tax_amount:null,tax_behavior:null,expires_at:new Date(f.now+3600000).toISOString()};}};
 const first=await f.service.checkout(owner,'plus',{currency:'usd'});assert.equal(first.url,'https://sandbox.polar.sh/checkout/1');
 assert.deepEqual(await f.service.checkout(owner,'plus',{currency:'usd'}),first,'the same plan reopens the open session');
 await assert.rejects(f.service.checkout(owner,'ultra',{currency:'usd'}),{code:'checkout_open'});assert.equal(created,1);
 f.advance(3600000);assert.equal((await f.service.checkout(owner,'ultra',{currency:'usd'})).url,'https://sandbox.polar.sh/checkout/2','an expired session no longer blocks');
}finally{f.close();}});

test('B3/I7: the operator reconcile operation is registered, reachable through the host account RPC, and refused to owner dispatch',async t=>{
 assert.equal(ACCOUNT_OPERATIONS['billing.change-lock-reconcile'],ReconcileBillingChangeLock);
 const directory=await mkdtemp(join(tmpdir(),'bindle-lock-rpc-'));const app=await createNodeServer({directory,config:{APP_ORIGIN:'http://localhost:8788'}});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const account=app.resources.accounts.get(owner);await account.metadata.put('owner',owner);
 assert.deepEqual(await account.invoke({method:'billingReconcileChangeLock',args:[owner,{reason:'operator-reconcile'}]}),{released:false,locked:false});
 assert.equal((await account.invoke({method:'billingReconcileChangeLock',args:[owner,{}]})).$fault.code,'invalid_request');
 assert.equal((await account.invoke({method:'dispatch',args:[owner,{operation:'billing.change-lock-reconcile',input:{}}]})).$fault.code,'forbidden');
});

// Re-review 2026-10-23.
async function twoSubscriptions(order){let now=Date.now();const metadata=new SqliteMetadata(':memory:'),config={APP_ORIGIN:'https://billing.example',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product'};
 const products=ids.map((id,i)=>({id:id+'-product',organization_id:'org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,prices:[{id:id+'-price',product_id:id+'-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:[500,3500,25000][i]}]}));
 const customer={id:'customer',external_id:owner,organization_id:'org',active_subscriptions:order.map(id=>({id}))},sub=(id,end)=>({id,customer_id:'customer',customer,product_id:'plus-product',amount:3500,currency:'usd',status:'active',recurring_interval:'year',recurring_interval_count:1,current_period_start:new Date(now-1000).toISOString(),current_period_end:new Date(now+end).toISOString(),cancel_at_period_end:false,pending_update:null}),subs={A:sub('A',300*DAY),B:sub('B',360*DAY)};
 const client={products:{get:async id=>structuredClone(products.find(p=>p.id===id))},customers:{getStateExternal:async()=>structuredClone(customer)},orders:{list:async()=>({items:[],pagination:{total_count:0}})},subscriptions:{get:async id=>{if(!subs[id])throw Object.assign(Error('missing'),{statusCode:404});return structuredClone(subs[id]);},update:async(id,args)=>{const v=subs[id];v.product_id=args.product_id;v.amount=products.find(p=>p.id===args.product_id).prices[0].price_amount;return structuredClone(v);}}};
 const service=new BillingService({config,metadata,client,now:()=>now});return {metadata,config,service,subs,get now(){return now;},advance:n=>now+=n,digest:async p=>(await service.status(owner)).plans.find(x=>x.id===p).priceDigest};}
test('re-review M1: a lapsed held state on one subscription never overrides a live paid one, in either order',async()=>{for(const order of [['A','B'],['B','A']]){const f=await twoSubscriptions(order);try{
 await f.service.reconcile(owner);const locked=(await f.metadata.get(BILLING_STATE_KEY)).subscriptionId,other=locked==='A'?'B':'A';
 await f.service.changes.change(owner,{plan:'ultra',txId:tx(1),priceDigest:await f.digest('ultra')});f.advance(DAY);f.subs[locked].status='past_due';await f.service.reconcile(owner);
 f.advance(361*DAY);Object.assign(f.subs[other],{current_period_start:new Date(f.now-1000).toISOString(),current_period_end:new Date(f.now+365*DAY).toISOString()});await f.service.reconcile(owner);
 const state=await f.metadata.get(BILLING_STATE_KEY);assert.equal(entitlementFromState(state,f.now,f.config).plan,'plus',order.join(''));assert.equal(state.subscriptionId,other,order.join(''));
}finally{f.metadata.close();}}});

test('re-review M2: concurrent checkouts from Free create exactly one provider session',async()=>{const f=fixture();try{f.customer.active_subscriptions=[];
 const c=await f.service.client();let created=0;c.checkouts={create:async args=>{created++;await new Promise(resolve=>setTimeout(resolve,20));const amount={'paid-product':500,'plus-product':3500,'ultra-product':25000}[args.products[0]];return {url:`https://sandbox.polar.sh/checkout/${created}`,currency:args.currency,amount,product_id:args.products[0],organization_id:'org',external_customer_id:owner,allow_discount_codes:true,discount_amount:0,net_amount:amount,total_amount:amount,tax_amount:null,tax_behavior:null,expires_at:new Date(f.now+3600000).toISOString()};}};
 const results=await Promise.allSettled([f.service.checkout(owner,'plus',{currency:'usd'}),f.service.checkout(owner,'ultra',{currency:'usd'}),f.service.checkout(owner,'plus',{currency:'usd'})]);
 assert.equal(created,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.code),['checkout_open','checkout_open']);
 assert.equal((await f.service.checkout(owner,'plus',{currency:'usd'})).url,'https://sandbox.polar.sh/checkout/1','the filled reservation reopens');
}finally{f.close();}});

test('re-review gap: an upward change made outside the app (provider portal) is held at the previous plan until a paid invoice',async()=>{const f=fixture();try{
 await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'paid');
 Object.assign(f.subscription,{product_id:'plus-product',amount:3500});await f.service.reconcile(owner);
 assert.equal((await plan(f)).plan,'paid','an unpaid portal upgrade is not granted');assert.notEqual(await f.metadata.get(UPGRADE_GUARD_PREFIX+'subscription'),undefined);assert.equal((await f.metadata.get(BILLING_STATE_KEY)).retentionAuthoritative,true);
 f.order();await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'plus');assert.equal(await f.metadata.get(UPGRADE_GUARD_PREFIX+'subscription'),undefined);
 // A downward change outside the app is not an upgrade and is not guarded.
 Object.assign(f.subscription,{product_id:'paid-product',amount:500});await f.service.reconcile(owner);assert.equal((await plan(f)).plan,'paid');assert.equal(await f.metadata.get(UPGRADE_GUARD_PREFIX+'subscription'),undefined);
}finally{f.close();}});
