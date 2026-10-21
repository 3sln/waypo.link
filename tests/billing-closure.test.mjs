import test from 'node:test';
import assert from 'node:assert/strict';
import {BillingClosure,CancelBillingAtPeriodEnd,UncancelBillingClosure,RevokeBillingClosure,AnonymizeBillingClosure,ClosureBillingWebhook,BILLING_CLOSURE_OPERATIONS} from '../packages/billing/closure.mjs';
import {BillingService} from '../packages/billing/service.mjs';
import {createFlags} from '../packages/flags/evaluate.mjs';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {fakeClock,forEachSeed,injectFaults,createScheduler} from './helpers/chaos.mjs';
const DAY=86400000,PREFIX='billing/closure-cancel/',EVIDENCE='billing/closure-evidence-v1';
const config={BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline-only',POLAR_WEBHOOK_SECRET:'offline-only',POLAR_ORGANIZATION_ID:'org',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product',APP_ORIGIN:'https://billing.example'};
const providerError=(error,statusCode=400)=>Object.assign(new Error('Provider detail must not escape'),{statusCode,error:{error}});
const actor={kind:'system',reason:'account-deletion',owner:OWNER};
const clone=value=>structuredClone(value);
const flags=(enabled=true,background=true)=>({for:ctx=>{assert.equal(ctx.subject.owner,OWNER);return {enabled:name=>{assert.equal(name,'ACCOUNT_DELETION_ENABLED');return enabled;},background:name=>{assert.equal(name,'ACCOUNT_DELETION_ENABLED');return background;}};}});
async function fixture({port=flags(),decorate=value=>value,wrap={}}={}){
 const clock=fakeClock(),calls=[],customer={id:'customer',external_id:OWNER,organization_id:'org',active_subscriptions:[]},subscriptions=new Map(),checkouts=[];let erased=false;
 const live=value=>value.status!=='incomplete_expired'&&(value.status!=='canceled'||value.cancel_at_period_end)&&!(value.ended_at&&Date.parse(value.ended_at)<=clock.now());
 const page=(items,query)=>({items:clone(items.slice((query.page-1)*query.limit,query.page*query.limit)),pagination:{total_count:items.length}});
 const raw={customers:{getStateExternal:async owner=>{calls.push(['customer',owner]);assert.equal(owner,OWNER);if(erased)throw providerError('ResourceNotFound',404);return {...clone(customer),active_subscriptions:[...subscriptions.values()].filter(live).map(value=>({id:value.id}))};},deleteExternal:async(owner,query)=>{calls.push(['anonymize',owner,query]);assert.deepEqual(query,{anonymize:true});if(erased)throw providerError('ResourceNotFound',404);assert(![...subscriptions.values()].some(live));erased=true;}},subscriptions:{list:async query=>{calls.push(['subscriptions',query]);assert.equal(query.external_customer_id,OWNER);return page(erased?[]:[...subscriptions.values()],query);},get:async id=>{calls.push(['get',id]);if(!subscriptions.has(id))throw providerError('ResourceNotFound',404);return clone(subscriptions.get(id));},update:async(id,body)=>{calls.push(['update',id,body]);const value=subscriptions.get(id);if(!live(value))throw providerError('InactiveSubscription');value.cancel_at_period_end=body.cancel_at_period_end;value.canceled_at=body.cancel_at_period_end?new Date(clock.now()).toISOString():null;return clone(value);},revoke:async id=>{calls.push(['revoke',id]);const value=subscriptions.get(id);if(!live(value))throw providerError('AlreadyCanceledSubscription');value.status='canceled';value.cancel_at_period_end=false;value.canceled_at=new Date(clock.now()).toISOString();value.ended_at=new Date(clock.now()).toISOString();return clone(value);}},checkouts:{list:async query=>{calls.push(['checkouts',query]);assert.equal(query.external_customer_id,OWNER);assert.equal(query.status,'open');return page(checkouts.filter(value=>value.status==='open'),query);}}};
 const client=decorate(raw),billing={config,closureAlert:entry=>t.audit.record(entry),reconcile:async owner=>{assert.equal(owner,OWNER);calls.push(['reconcile']);}},t=await createTestEngine({clock,providers:{billing,billingProvider:client,flags:port},wrap});
 await t.metadata.put('owner',OWNER);
 const add=(id='subscription',extra={})=>{const value={id,customer_id:customer.id,customer:clone(customer),product_id:'paid-product',status:'active',cancel_at_period_end:false,canceled_at:null,ended_at:null,current_period_start:new Date(clock.now()-DAY).toISOString(),current_period_end:new Date(clock.now()+DAY).toISOString(),...extra};subscriptions.set(id,value);return value;};
 const run=(Operation,input,as=actor)=>t.perform(new Operation({actor:as,input}));
 const portFor=()=>new BillingClosure({billing,metadata:t.metadata,client,clock,flags:port,alert:entry=>t.audit.record(entry)});
 return {t,clock,calls,customer,subscriptions,checkouts,client,raw,billing,add,run,port:portFor,erased:()=>erased};
}
test('closure Actions are engine operations, system-only, owner-bound and flag-off',async()=>{
 const f=await fixture({port:flags(false)});try{
  assert.equal(Object.keys(BILLING_CLOSURE_OPERATIONS).length,5);
  for(const Operation of Object.values(BILLING_CLOSURE_OPERATIONS)){assert.equal(Operation.lifecycle,'purging');assert.equal(Operation.termsGate,'exempt');await assert.rejects(f.run(Operation,{}, {kind:'owner',owner:OWNER}),{code:'forbidden'});}
  await assert.rejects(f.run(CancelBillingAtPeriodEnd),{code:'account_deletion_disabled'});
  await assert.rejects(f.run(RevokeBillingClosure),{code:'account_deletion_disabled'});
  await assert.rejects(f.run(RevokeBillingClosure,undefined,{...actor,owner:OTHER}),{code:'forbidden'});assert.equal(f.calls.length,0);
 }finally{await f.t.dispose();}
});
test('the actual default flags port refuses new closure work',async()=>{
 const f=await fixture({port:createFlags({snapshot:{v:1,version:0,issuedAt:0,flags:{}}})});try{await assert.rejects(f.run(CancelBillingAtPeriodEnd),{code:'account_deletion_disabled'});assert.equal(f.calls.length,0);}finally{await f.t.dispose();}
});
test('request cancellation records only our timestamps; retry and cancel preserve portal decisions and ended periods',async()=>{
 const f=await fixture();try{
  f.add('ours');const portal=f.add('portal',{cancel_at_period_end:true,canceled_at:new Date(f.clock.now()-1000).toISOString()}),later=f.add('later'),ended=f.add('ended');
  const result=await f.run(CancelBillingAtPeriodEnd);assert.deepEqual(result.set.map(value=>value.subscriptionId),['ours','later','ended']);
  assert.deepEqual((await f.run(CancelBillingAtPeriodEnd)).set,result.set);assert.equal(f.calls.filter(value=>value[0]==='update').length,3);
  f.clock.advance(1000);later.canceled_at=new Date(f.clock.now()).toISOString();ended.current_period_end=new Date(f.clock.now()).toISOString();
  const cancelled=await f.run(UncancelBillingClosure,{set:result.set});assert.deepEqual(cancelled.restored,['ours']);assert.deepEqual(cancelled.unrestored,[{subscriptionId:'ended',reason:'ended'},{subscriptionId:'later',reason:'changed'}]);
  assert.equal(portal.cancel_at_period_end,true);assert.equal(later.cancel_at_period_end,true);assert.equal(ended.cancel_at_period_end,true);
  await f.run(UncancelBillingClosure,{set:result.set});assert.equal(f.calls.filter(value=>value[0]==='update'&&value[2].cancel_at_period_end===false).length,1);
  await assert.rejects(f.run(UncancelBillingClosure,{set:[{subscriptionId:'portal',canceledAt:portal.canceled_at}]}),{code:'invalid_request'});
 }finally{await f.t.dispose();}
});
test('continuation ignores rollout targeting; an env kill holds execution, while uncancel remains available',async()=>{
 const f=await fixture({port:flags(false)});try{const subscription=f.add();await f.t.metadata.put('deletion/request-v1',{state:'scheduled'});const result=await f.run(CancelBillingAtPeriodEnd);assert(subscription.cancel_at_period_end);await f.run(UncancelBillingClosure,{set:result.set});assert(!subscription.cancel_at_period_end);}finally{await f.t.dispose();}
 const killed=await fixture({port:flags(true,false)});try{await killed.t.metadata.put('deletion/fence-v1',{owner:OWNER});for(const Operation of [RevokeBillingClosure,AnonymizeBillingClosure])await assert.rejects(killed.run(Operation),{code:'account_deletion_disabled'});assert.equal(killed.calls.length,0);}finally{await killed.t.dispose();}
});
test('E1 revokes every renewable status and all products, then checks checkouts and fresh customer state',async()=>{
 const f=await fixture();try{
  for(const status of ['active','past_due','trialing','paused','unpaid','incomplete'])f.add(status,{status,product_id:'uncatalogued-product'});
  f.add('scheduled',{status:'canceled',cancel_at_period_end:true,canceled_at:new Date(f.clock.now()).toISOString()});f.add('ended',{status:'canceled',ended_at:new Date(f.clock.now()).toISOString()});
  const evidence=await f.run(RevokeBillingClosure);assert.equal(evidence.revoked.length,7);assert.equal(evidence.activeSubscriptions,0);assert.equal(evidence.openCheckouts,0);assert.equal(f.calls[0][0],'reconcile');
  assert(f.calls.findIndex(value=>value[0]==='checkouts')>f.calls.findLastIndex(value=>value[0]==='revoke'));assert.deepEqual((await f.run(RevokeBillingClosure)).revoked,[]);
 }finally{await f.t.dispose();}
});
test('open checkout holds E1 even without a customer and only provider expiry releases it',async()=>{
 const f=await fixture();try{f.checkouts.push({id:'checkout',external_customer_id:OWNER,organization_id:'org',status:'open',expires_at:new Date(f.clock.now()+DAY).toISOString()});await f.raw.customers.deleteExternal(OWNER,{anonymize:true});
  await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_checkout_open'});assert.equal(await f.t.metadata.get(EVIDENCE),undefined);
  f.clock.advance(2*DAY);await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_checkout_open'});f.checkouts[0].status='expired';assert.equal((await f.run(RevokeBillingClosure)).openCheckouts,0);
 }finally{await f.t.dispose();}
});
test('pagination is complete and bounded; malformed or foreign state never authorizes a destructive call',async()=>{
 const f=await fixture();try{for(let n=0;n<101;n++)f.add('subscription_'+n,{status:'canceled',ended_at:new Date(f.clock.now()).toISOString()});f.add('last');assert.deepEqual((await f.run(RevokeBillingClosure)).revoked,['last']);assert(f.calls.some(value=>value[0]==='subscriptions'&&value[1].page===2));
  const foreign=f.add('foreign');foreign.customer.external_id=OTHER;f.calls.length=0;await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_provider_unavailable'});assert(!f.calls.some(value=>value[0]==='revoke'));
 }finally{await f.t.dispose();}
 for(const response of [{items:[],pagination:{total_count:201}},{items:[],pagination:{total_count:1}},{items:[{id:'same'},{id:'same'}],pagination:{total_count:2}}]){const bad=await fixture();try{bad.raw.subscriptions.list=async()=>response;await assert.rejects(bad.run(RevokeBillingClosure),{code:'billing_provider_unavailable'});}finally{await bad.t.dispose();}}
});
test('provider errors hold E1/E9, suppress details, and never manufacture successful evidence',async()=>{
 for(const target of ['reconcile','revoke','checkouts','anonymize']){
  const f=await fixture();try{f.add();if(target==='reconcile')f.billing.reconcile=async()=>{throw providerError('offline',503);};else if(target==='revoke')f.raw.subscriptions.revoke=async()=>{throw providerError('offline',503);};else if(target==='checkouts')f.raw.checkouts.list=async()=>{throw providerError('offline',503);};else f.raw.customers.deleteExternal=async()=>{throw providerError('offline',503);};
   await assert.rejects(f.run(target==='anonymize'?AnonymizeBillingClosure:RevokeBillingClosure),error=>error.code==='billing_provider_unavailable'&&!error.message.includes('Provider detail'));
   assert.equal(f.erased(),false);assert.notEqual((await f.t.metadata.get(EVIDENCE))?.kind,'anonymize');
  }finally{await f.t.dispose();}
 }
});
test('already-revoked SDK error is success only after an inactive read; arbitrary 404 is a hold',async()=>{
 const f=await fixture();try{const subscription=f.add();f.raw.subscriptions.revoke=async()=>{subscription.status='canceled';subscription.cancel_at_period_end=false;subscription.ended_at=new Date(f.clock.now()).toISOString();throw providerError('AlreadyCanceledSubscription');};assert.deepEqual((await f.run(RevokeBillingClosure)).revoked,['subscription']);
  subscription.status='active';subscription.ended_at=null;f.raw.subscriptions.revoke=async()=>{throw providerError('AlreadyCanceledSubscription');};await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_provider_unavailable'});
  f.raw.customers.getStateExternal=async()=>{throw Object.assign(new Error('404'),{statusCode:404});};await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_provider_unavailable'});
 }finally{await f.t.dispose();}
});
test('E9 anonymizes by external ID, rechecks E1, and is idempotent after external ID disappears',async()=>{
 const f=await fixture();try{f.add();const result=await f.run(AnonymizeBillingClosure);assert.equal(result.anonymized,true);assert(f.erased());assert(f.calls.findIndex(value=>value[0]==='anonymize')>f.calls.findIndex(value=>value[0]==='revoke'));assert.equal((await f.run(AnonymizeBillingClosure)).anonymized,true);}finally{await f.t.dispose();}
 const open=await fixture();try{open.checkouts.push({id:'checkout',external_customer_id:OWNER,organization_id:'org',status:'open',expires_at:new Date(open.clock.now()+DAY).toISOString()});await assert.rejects(open.run(AnonymizeBillingClosure),{code:'billing_checkout_open'});assert(!open.calls.some(value=>value[0]==='anonymize'));}finally{await open.t.dispose();}
});
test('fresh paid state after revoke and a false anonymization success both hold before the wipe',async()=>{
 const f=await fixture();try{f.add();const get=f.raw.customers.getStateExternal;let reads=0;f.raw.customers.getStateExternal=async owner=>{if(++reads===2)f.add('late');return get(owner);};await assert.rejects(f.run(RevokeBillingClosure),{code:'billing_provider_unavailable'});assert.equal(await f.t.metadata.get(EVIDENCE),undefined);assert.equal(f.subscriptions.get('late').status,'active');assert.equal((await f.run(RevokeBillingClosure)).activeSubscriptions,0);
  f.raw.customers.deleteExternal=async()=>{};await assert.rejects(f.run(AnonymizeBillingClosure),{code:'billing_provider_unavailable'});assert.notEqual((await f.t.metadata.get(EVIDENCE)).kind,'anonymize');
 }finally{await f.t.dispose();}
});
test('a false or foreign cancellation response is never adopted as owned evidence',async()=>{
 for(const wrong of ['owner','cancelled']){const f=await fixture();try{f.add();const update=f.raw.subscriptions.update;f.raw.subscriptions.update=async(...args)=>{const value=await update(...args);if(wrong==='owner')value.customer.external_id=OTHER;else value.cancel_at_period_end=false;return value;};await assert.rejects(f.run(CancelBillingAtPeriodEnd),{code:'billing_provider_unavailable'});assert.equal((await f.t.metadata.get(PREFIX+'subscription')).state,'unknown');assert.equal(await f.t.metadata.get(EVIDENCE),undefined);}finally{await f.t.dispose();}}
});
test('the trusted port obtains the existing BillingService SDK client when no override is supplied',async()=>{
 const f=await fixture();try{let obtained=0;f.billing.client=async()=>{obtained++;return f.client;};const port=new BillingClosure({billing:f.billing,metadata:f.t.metadata,clock:f.clock,flags:flags()});f.add();assert.equal((await port.revokeAll(OWNER)).activeSubscriptions,0);assert.equal(obtained,1);}finally{await f.t.dispose();}
});
test('late paid events for fenced/deleted owners alert and revoke; unrelated events change nothing',async()=>{
 for(const deleted of [false,true])for(const type of ['subscription.created','subscription.active','order.paid']){
  const f=await fixture({port:flags(false)});try{f.add();if(!deleted)await f.t.metadata.put('deletion/fence-v1',{owner:OWNER});const before=await f.t.metadata.list(),input={deleted,verified:{id:'event',type,owner:OWNER}};assert.equal((await f.run(ClosureBillingWebhook,input)).revoked,true);assert.equal(f.t.audit.entries.filter(value=>value.type==='billing-after-deletion').length,1);assert.equal((await f.run(ClosureBillingWebhook,input)).accepted,true);if(deleted){assert.deepEqual(await f.t.metadata.list(),before);assert(!f.calls.some(value=>value[0]==='reconcile'));}
   f.calls.length=0;assert.equal((await f.run(ClosureBillingWebhook,{deleted,verified:{id:'unrelated',type:'subscription.updated',owner:OWNER}})).ignored,true);assert.equal(f.calls.length,0);
  }finally{await f.t.dispose();}
 }
 const active=await fixture();try{active.add();assert.equal((await active.run(ClosureBillingWebhook,{verified:{id:'event',type:'order.paid',owner:OWNER}})).ignored,true);assert.equal(active.calls.length,0);}finally{await active.t.dispose();}
});
test('late paid event alerts survive a revoke outage and the direct port refuses a missing alert transport',async()=>{
 const f=await fixture();try{f.add();await f.t.metadata.put('deletion/fence-v1',{owner:OWNER});f.raw.subscriptions.revoke=async()=>{throw providerError('offline',503);};await assert.rejects(f.run(ClosureBillingWebhook,{verified:{id:'event',type:'order.paid',owner:OWNER}}),{code:'billing_provider_unavailable'});assert(f.t.audit.entries.some(value=>value.type==='billing-after-deletion'));
  delete f.billing.closureAlert;f.raw.subscriptions.revoke=async id=>{const value=f.subscriptions.get(id);value.status='canceled';value.cancel_at_period_end=false;value.ended_at=new Date(f.clock.now()).toISOString();return clone(value);};await assert.rejects(f.run(ClosureBillingWebhook,{verified:{id:'event',owner:OWNER,type:'order.paid'}}),{code:'billing_alert_unavailable'});assert.equal(f.subscriptions.get('subscription').status,'canceled');
 }finally{await f.t.dispose();}
});
test('real BillingService reconciliation composes with closure over offline Polar fakes',async()=>{
 const f=await fixture();try{f.raw.products={get:async id=>({id,is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,organization_id:'org',prices:[{id:id+'-price',product_id:id,source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:id==='paid-product'?500:id==='plus-product'?3500:25000}]})};
  const billing=new BillingService({config,metadata:f.t.metadata,client:f.client,now:f.clock.now});assert.equal((await new BillingClosure({billing,metadata:f.t.metadata,client:f.client,clock:f.clock,flags:flags()}).revokeAll(OWNER)).activeSubscriptions,0);
 }finally{await f.t.dispose();}
});
test('seeded lost replies at every E1/E9 provider boundary converge after port restart',async()=>{
 const boundaries=[['subscriptions','list',1],['subscriptions','revoke',1],['subscriptions','get',1],['checkouts','list',1],['customers','getStateExternal',1],['customers','getStateExternal',2],['customers','deleteExternal',1]];
 await forEachSeed(5,async random=>{for(const [group,method,when]of random.shuffle(boundaries)){
  const f=await fixture({decorate:client=>({...client,[group]:injectFaults(client[group],[{method,when,mode:'after'}],{random})})});try{f.add();await assert.rejects(f.run(AnonymizeBillingClosure),{code:'billing_provider_unavailable'});assert.equal((await f.port().anonymize(OWNER)).anonymized,true);assert(f.erased());assert(f.calls.some(value=>value[0]==='revoke'));assert.equal([...f.subscriptions.values()].filter(value=>value.status==='active').length,0);}finally{await f.t.dispose();}
 }});
});
test('cancellation lost responses and journal commit failures preserve attribution across restarts',async()=>{
 for(const mode of ['throw','after']){const f=await fixture({decorate:client=>({...client,subscriptions:injectFaults(client.subscriptions,[{method:'update',when:1,mode}])})});try{const subscription=f.add();await assert.rejects(f.run(CancelBillingAtPeriodEnd),{code:'billing_provider_unavailable'});const retry=await f.port().cancelAtPeriodEnd(OWNER);
  if(mode==='throw'){assert.equal(retry.set.length,1);assert.deepEqual((await f.port().uncancel(OWNER,retry.set)).restored,['subscription']);}else{assert.deepEqual(retry.uncertain,['subscription']);const cancelled=await f.port().uncancel(OWNER,[]);assert.equal(cancelled.unrestored[0].reason,'uncertain');assert(subscription.cancel_at_period_end);}
 }finally{await f.t.dispose();}}
 const committed=await fixture({wrap:{accountStore:store=>injectFaults(store,[{method:'transaction',when:2,mode:'after'}])}});try{committed.add();await assert.rejects(committed.run(CancelBillingAtPeriodEnd),{code:'billing_provider_unavailable'});assert.equal((await committed.port().cancelAtPeriodEnd(OWNER)).set.length,1);assert.deepEqual((await committed.port().uncancel(OWNER,[])).restored,['subscription']);}finally{await committed.t.dispose();}
 const reserved=await fixture();try{reserved.add();await reserved.t.metadata.put(PREFIX+'subscription',{v:1,owner:OWNER,server:config.POLAR_SERVER,origin:config.APP_ORIGIN,customerId:'customer',organizationId:'org',subscriptionId:'subscription',state:'reserved',at:reserved.clock.now()});await assert.rejects(reserved.run(CancelBillingAtPeriodEnd),{code:'billing_closure_pending'});reserved.clock.advance(60001);assert.equal((await reserved.run(CancelBillingAtPeriodEnd)).set.length,1);}finally{await reserved.t.dispose();}
});
test('seeded duplicate cancellation/revoke schedules converge without duplicate cancellation updates',async()=>{
 await forEachSeed(30,async random=>{
  const scheduler=createScheduler(random),f=await fixture({decorate:client=>Object.fromEntries(Object.entries(client).map(([name,value])=>[name,scheduler.wrap(value,name)]))});try{
   f.add();const results=await scheduler.run([()=>f.run(CancelBillingAtPeriodEnd),()=>f.run(CancelBillingAtPeriodEnd)]);assert(results.some(value=>value.status==='fulfilled'));assert.equal(f.calls.filter(value=>value[0]==='update').length,1);assert.equal((await f.port().cancelAtPeriodEnd(OWNER)).set.length,1);
   await scheduler.run([()=>f.run(RevokeBillingClosure),()=>f.run(RevokeBillingClosure)]);assert.equal((await f.port().revokeAll(OWNER)).activeSubscriptions,0);assert.equal(f.subscriptions.get('subscription').cancel_at_period_end,false);
  }finally{await f.t.dispose();}
 });
});
