// Organization plans and billing (packages/billing/organizations.mjs) against an offline Polar model. Sandbox only:
// these tests prove local verification rules, not provider conformance or delivery.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OrganizationBilling,ORGANIZATION_PLANS,organizationBillingConfiguration,organizationBillingConfigured,organizationProductEvent,validOrganizationPlanParameters} from '../packages/billing/organizations.mjs';
import {BillingService} from '../packages/billing/service.mjs';
import {fakeOrgPolar,ORG_POLAR_CONFIG} from './helpers/org-polar.mjs';
import {fakeClock} from '../packages/app/memory-providers.mjs';
const ORG='dddddddd-dddd-4ddd-8ddd-dddddddddddd',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const setup=(config=ORG_POLAR_CONFIG)=>{const clock=fakeClock(Date.UTC(2026,9,23)),polar=fakeOrgPolar({clock});return {clock,polar,billing:new OrganizationBilling({config,client:polar.client,now:clock.now})};};
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);

test('the provisional catalog reaches 100 TB, is marked provisional, and runs only in the Polar sandbox',async()=>{
 assert.deepEqual(Object.values(ORGANIZATION_PLANS).map(p=>[p.id,p.storageBytes,p.provisional]),[['org-team',1e12,true],['org-business',1e13,true],['org-scale',1e14,true]]);
 for(const plan of Object.values(ORGANIZATION_PLANS))assert.ok(validOrganizationPlanParameters(plan));
 assert.equal(validOrganizationPlanParameters({...ORGANIZATION_PLANS['org-scale'],storageBytes:1e14+1}),false);
 for(const [config,code] of [[{...ORG_POLAR_CONFIG,POLAR_SERVER:'production'},'billing_unconfigured'],[{...ORG_POLAR_CONFIG,BILLING_ENABLED:'false'},'billing_disabled'],[{...ORG_POLAR_CONFIG,POLAR_PRODUCT_ID_ORG_SCALE:''},'billing_unconfigured'],[{...ORG_POLAR_CONFIG,POLAR_PRODUCT_ID_ORG_SCALE:'org-team-product'},'billing_unconfigured'],[{...ORG_POLAR_CONFIG,POLAR_ACCESS_TOKEN:''},'billing_unconfigured']])
  assert.throws(()=>organizationBillingConfiguration(config),e=>e.code===code);
 const live=setup({...ORG_POLAR_CONFIG,POLAR_SERVER:'production'});await rejects(live.billing.catalog(),'billing_unconfigured');await rejects(live.billing.checkout(ORG,{owner:A,plan:'org-team',purpose:'create',binding:'r',returnPath:'/console?x=1'}),'billing_unconfigured');assert.equal(live.polar.calls.length,0);
 assert.equal(organizationBillingConfigured(ORG_POLAR_CONFIG),true);assert.equal(organizationBillingConfiguration({...ORG_POLAR_CONFIG,POLAR_CATALOG_MODE:'metadata',POLAR_ORGANIZATION_ID:'polar-org'}).mode,'metadata');
 assert.equal(organizationProductEvent({productId:'org-team-product'},ORG_POLAR_CONFIG),true);assert.equal(organizationProductEvent({productId:'paid-product'},ORG_POLAR_CONFIG),false);
});

test('catalog verification: static amounts, annual fixed prices, one organization; metadata mode reads marked products',async()=>{
 const {billing,polar}=setup();const catalog=await billing.catalog();assert.equal(catalog.entries['org-scale'].prices.usd.amount,ORGANIZATION_PLANS['org-scale'].annualAmount);assert.equal(catalog.provisional,true);
 const plans=await billing.plans('eur');assert.equal(plans.currency,'eur');assert.equal(plans.plans.length,3);assert.ok(plans.plans.every(p=>p.provisional));
 const bad=setup();bad.polar.products['org-team-product'].prices[0].price_amount=1;await rejects(bad.billing.catalog(),'billing_catalog_mismatch');
 const monthly=setup();monthly.polar.products['org-business-product'].recurring_interval='month';await rejects(monthly.billing.catalog(),'billing_catalog_mismatch');
 const meta=setup({...ORG_POLAR_CONFIG,POLAR_CATALOG_MODE:'metadata',POLAR_ORGANIZATION_ID:'polar-org'});
 for(const [id,product] of Object.entries(meta.polar.products)){const plan=id.replace('-product','');product.metadata={'3sln_me_service':ORG_POLAR_CONFIG.APP_ORIGIN,'3sln_me_catalog':'organization','3sln_me_plan':plan,'3sln_me_storage_bytes':String(ORGANIZATION_PLANS[plan].storageBytes),'3sln_me_ai_credits':'5','3sln_me_members':'9'};}
 const mc=await meta.billing.catalog();assert.equal(mc.entries['org-team'].parameters.aiCreditsMonthly,5);
 meta.polar.products['org-scale-product'].metadata['3sln_me_storage_bytes']=String(2e14);meta.billing.cache=null;await rejects(meta.billing.catalog(),'billing_catalog_mismatch');
 assert.ok(polar.calls.every(([name])=>name==='products.get'));
});

test('the person catalog skips organization products in metadata mode (service.mjs hunk)',async()=>{
 const products=[];const add=(id,meta,amount)=>products.push({id,name:id,organization_id:'polar-org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,metadata:meta,prices:[{id:id+'-usd',product_id:id,source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:amount}]});
 for(const [plan,amount,bytes] of [['paid',500,5e9],['plus',3500,1e11],['ultra',25000,1e12]])add(plan+'-p',{'3sln_me_service':'https://3sln.example','3sln_me_catalog':'1','3sln_me_plan':plan,'3sln_me_storage_bytes':String(bytes),'3sln_me_activity_hour':'2000','3sln_me_activity_day':'10000'},amount);
 add('org-team-product',{'3sln_me_service':'https://3sln.example','3sln_me_catalog':'organization','3sln_me_plan':'org-team'},120000);
 const client={products:{list:async()=>({items:structuredClone(products),pagination:{total_count:products.length}})}};
 const service=new BillingService({config:{BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'x',POLAR_WEBHOOK_SECRET:'y',POLAR_CATALOG_MODE:'metadata',POLAR_ORGANIZATION_ID:'polar-org',APP_ORIGIN:'https://3sln.example'},metadata:null,client});
 const catalog=await service.catalog();assert.deepEqual(Object.keys(catalog.entries),['paid','plus','ultra']);assert.equal(catalog.entries.paid.id,'paid-p');
});

test('checkout binds the organization as customer and the creating person, purpose and binding in metadata',async()=>{
 const {billing,polar}=setup();
 const checkout=await billing.checkout(ORG,{owner:A,plan:'org-business',purpose:'transfer',binding:'transfer-1',returnPath:'/console?org_transfer='+ORG,currency:'eur'});
 assert.match(checkout.url,/^https:\/\/sandbox\.polar\.sh\//);assert.equal(checkout.amount,ORGANIZATION_PLANS['org-business'].annualAmount);
 const body=polar.calls.find(([n])=>n==='checkouts.create')[1];assert.equal(body.external_customer_id,ORG);assert.equal(body.allow_discount_codes,false);assert.equal(body.allow_trial,false);assert.deepEqual(body.metadata,{'3sln_me_org_owner':A,'3sln_me_org_purpose':'transfer','3sln_me_org_binding':'transfer-1','3sln_me_org':ORG});assert.equal(body.success_url,'https://3sln.example/console?org_transfer='+ORG);
 await rejects(billing.checkout(ORG,{owner:ORG,plan:'org-team',purpose:'create',binding:'x',returnPath:'/console?a=1'}),'invalid_request');
 await rejects(billing.checkout(ORG,{owner:A,plan:'org-team',purpose:'gift',binding:'x',returnPath:'/console?a=1'}),'invalid_request');
 await rejects(billing.checkout(ORG,{owner:A,plan:'org-team',purpose:'create',binding:'x',returnPath:'https://evil.example/'}),'invalid_request');
 const original=polar.client.checkouts.create;polar.client.checkouts.create=async b=>({...await original(b),metadata:{...b.metadata,'3sln_me_org_owner':B}});await rejects(billing.checkout(ORG,{owner:A,plan:'org-team',purpose:'create',binding:'x',returnPath:'/console?a=1'}),'billing_checkout_mismatch');
 polar.client.checkouts.create=async b=>({...await original(b),url:'https://polar.sh/checkout/1'});await rejects(billing.checkout(ORG,{owner:A,plan:'org-team',purpose:'create',binding:'x',returnPath:'/console?a=1'}),'billing_provider_unavailable');
});

test('state trusts only verified subscriptions: metadata, organization, product, amount and a captured unrefunded order',async()=>{
 const {billing,polar}=setup();assert.deepEqual((await billing.state(ORG)).subscriptions,[]);
 const good=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'request-1'});
 const forged=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'request-2'});delete polar.subscriptions.get(forged.subscription).metadata['3sln_me_org_owner'];
 const other=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'request-3'});polar.subscriptions.get(other.subscription).metadata['3sln_me_org']=B;
 const cheap=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'request-4'});polar.subscriptions.get(cheap.subscription).amount=1;
 const unpaid=polar.subscribe({org:ORG,owner:B,purpose:'transfer',binding:'t'});polar.orders.get(unpaid.order).status='pending';polar.orders.get(unpaid.order).paid=false;
 const state=await billing.state(ORG);assert.deepEqual(state.subscriptions.map(s=>[s.id,s.owner,s.paid]).sort(),[[good.subscription,A,true],[unpaid.subscription,B,false]].sort());
 // A partial (goodwill) refund leaves the order paid; only a full refund, or one of at least the net amount, does not.
 polar.orders.get(good.order).refunded_amount=10;polar.orders.get(good.order).status='partially_refunded';let after=(await billing.state(ORG)).subscriptions.find(s=>s.id===good.subscription);assert.equal(after.paid,true);assert.equal(after.refunded,false);
 polar.orders.get(good.order).refunded_amount=polar.orders.get(good.order).net_amount;after=(await billing.state(ORG)).subscriptions.find(s=>s.id===good.subscription);assert.equal(after.paid,false);assert.equal(after.refunded,true);
 polar.orders.get(good.order).refunded_amount=0;polar.orders.get(good.order).status='paid';
 polar.lapse(good.subscription);const known=await billing.state(ORG,{known:[good.subscription]});assert.equal(known.subscriptions.find(s=>s.id===good.subscription).status,'canceled');
});

test('a known subscription is verified against the terms it was bought at; a gone or changed one is reported unverified',async()=>{
 const {billing,polar,clock}=setup(),s=polar.subscribe({org:ORG,owner:A,purpose:'create',binding:'request-1',currency:'eur'}),gone=polar.subscribe({org:ORG,owner:A,purpose:'renew',binding:'renew-1'});
 const terms={[s.subscription]:{amount:ORGANIZATION_PLANS['org-team'].annualAmount,currency:'eur'},[gone.subscription]:{amount:ORGANIZATION_PLANS['org-team'].annualAmount,currency:'usd'}};
 // The operator archives the EUR price and adds a dearer one: the existing subscription still verifies at its own price.
 const product=polar.products['org-team-product'];product.prices.find(x=>x.price_currency==='eur').is_archived=true;product.prices.push({id:'org-team-product-eur2',product_id:'org-team-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'eur',price_amount:130000});clock.advance(10*60000);
 let state=await billing.state(ORG,{known:terms});assert.deepEqual(state.subscriptions.map(x=>[x.id,x.currency,x.paid]).sort(),[[s.subscription,'eur',true],[gone.subscription,'usd',true]].sort());assert.deepEqual(state.unverified,[]);
 // Without pinned terms (a new subscription) today's catalog decides, and the archived price no longer verifies.
 assert.deepEqual((await billing.state(ORG)).subscriptions.map(x=>x.id),[gone.subscription]);
 // Changed terms or a vanished subscription are reported, never silently dropped.
 polar.subscriptions.get(s.subscription).amount=1;polar.subscriptions.delete(gone.subscription);state=await billing.state(ORG,{known:terms});
 assert.deepEqual(state.subscriptions,[]);assert.deepEqual(state.unverified,[{id:s.subscription,reason:'unverifiable'},{id:gone.subscription,reason:'missing'}].sort((x,y)=>x.id.localeCompare(y.id)));
 const empty=setup();assert.deepEqual((await empty.billing.state(ORG,{known:{sub_x:{amount:1,currency:'usd'}}})).unverified,[{id:'sub_x',reason:'missing'}]);
});

test('a refund after a partial refund returns the remainder of the net amount, once',async()=>{
 const {billing,polar}=setup(),s=polar.subscribe({org:ORG,owner:B,purpose:'transfer',binding:'t'}),o=polar.orders.get(s.order);o.refunded_amount=100;o.status='partially_refunded';
 assert.equal((await billing.refund(ORG,{subscriptionId:s.subscription,orderId:s.order})).amount,o.net_amount-100);assert.equal(o.refunded_amount,o.net_amount);assert.equal(o.status,'refunded');
 assert.equal((await billing.refund(ORG,{subscriptionId:s.subscription,orderId:s.order})).already,true);assert.equal(polar.effects.refunds.length,1);
});

test('revoke and refund are idempotent at the provider and refuse another customer’s objects',async()=>{
 const {billing,polar}=setup();const s=polar.subscribe({org:ORG,owner:B,purpose:'transfer',binding:'t'});
 assert.deepEqual(await billing.revoke(ORG,s.subscription),{revoked:true});assert.equal((await billing.revoke(ORG,s.subscription)).already,true);assert.equal(polar.effects.revoked.length,1);
 assert.equal((await billing.refund(ORG,{subscriptionId:s.subscription,orderId:s.order})).amount,ORGANIZATION_PLANS['org-team'].annualAmount);assert.equal((await billing.refund(ORG,{subscriptionId:s.subscription,orderId:s.order})).already,true);assert.equal(polar.effects.refunds.length,1);
 const foreign=polar.subscribe({org:B,owner:A,purpose:'create',binding:'x'});await rejects(billing.revoke(ORG,foreign.subscription),'billing_provider_unavailable');await rejects(billing.refund(ORG,{subscriptionId:foreign.subscription,orderId:foreign.order}),'billing_provider_unavailable');
});
