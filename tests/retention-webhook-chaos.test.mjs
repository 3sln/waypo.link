import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {fakeClock,forEachSeed,createScheduler} from './helpers/chaos.mjs';
import {BillingService,BILLING_TRANSITION_PREFIX} from '../packages/billing/service.mjs';
import {BILLING_PLANS} from '../packages/billing/catalog.mjs';
import {ProduceRetention,SaveRetentionKeep,RETENTION_LEDGER} from '../packages/runtime/retention.mjs';
import {OVER_QUOTA_EPISODE} from '../packages/runtime/export-hooks.mjs';
import {key} from '../packages/core/records.mjs';
const DAY=86400000,config={APP_ORIGIN:'https://retention.example',OVER_QUOTA_RETENTION_ENABLED:'true',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid-product',POLAR_PRODUCT_ID_PLUS:'plus-product',POLAR_PRODUCT_ID_ULTRA:'ultra-product'};
test('seeded real billing webhook replay, same-period toggle, skew, upload and keep contention renews grace only through bounded recorded releases and never deletes content',async()=>{
 await forEachSeed(16,async random=>{
  const clock=fakeClock(),start=clock.now(),scheduler=createScheduler(random),f=await createTestEngine({clock,seed:random.seed,config,wrap:{accountStore:s=>scheduler.wrap(s,'engine-store')}});
  try{
   assert(f.metadata instanceof SqliteMetadata);await f.metadata.put('owner',OWNER);
   const customer={id:'customer',external_id:OWNER,organization_id:'org',active_subscriptions:[{id:'subscription'}]},subscription={id:'subscription',customer_id:'customer',customer,product_id:'plus-product',amount:3500,currency:'usd',status:'active',recurring_interval:'year',recurring_interval_count:1,current_period_start:new Date(start-DAY).toISOString(),current_period_end:new Date(start+365*DAY).toISOString(),cancel_at_period_end:false,ended_at:null};
   const products=['paid','plus','ultra'].map(plan=>({id:plan+'-product',organization_id:'org',is_archived:false,is_recurring:true,recurring_interval:'year',recurring_interval_count:1,prices:[{id:plan+'-price',product_id:plan+'-product',source:'catalog',is_archived:false,amount_type:'fixed',price_currency:'usd',price_amount:BILLING_PLANS[plan].annualAmount}]}));
   const client={products:{get:async id=>structuredClone(products.find(p=>p.id===id))},customers:{getStateExternal:async()=>structuredClone(customer)},subscriptions:{get:async()=>structuredClone(subscription)}};
   const billing=new BillingService({config,metadata:scheduler.wrap(f.metadata,'billing-store'),client,now:clock.now});
   const system={kind:'system',owner:OWNER},owner={kind:'owner',owner:OWNER},produce=()=>f.perform(new ProduceRetention({actor:system})),episode=()=>f.metadata.get(OVER_QUOTA_EPISODE);
   const initial={size:6000000000,version:'original',blobRef:'content-must-survive'},message={id:'m',owner:OWNER,collection:'inbox',size:10,blobRef:'message-must-survive'};
   await f.metadata.put('resource/r',{id:'r',owner:OWNER,provider:'hosted'});await f.metadata.put('hosted/r/original',initial);await f.metadata.put('hosted-usage',{bytes:initial.size,objects:1});await f.metadata.put(key('collection',OWNER,'inbox'),{id:'inbox',owner:OWNER,name:'Inbox'});await f.metadata.put(key('message',OWNER,'m'),message);await f.metadata.put(key('message-usage',OWNER),{bytes:10,messages:1});
   await billing.reconcile(OWNER);
   const event=n=>({owner:OWNER,id:'event-'+n,bodyHash:'a'.repeat(64),type:'subscription.updated',eventTimestamp:clock.now()});
   Object.assign(subscription,{product_id:'paid-product',amount:500,modified_at:new Date(start).toISOString()});const first=event(0);await billing.applyWebhook(first);await produce();const original=await episode();assert.equal(original.deadlineAt,start+30*DAY);
   // Review M4: an episode may change only after a recorded anchor release; purchase releases are bounded to
   // one per window, so same-period toggles cannot keep renewing grace.
   let expectedTransitions=1,current=original,episodes=new Set([original.id]);
   for(let n=1;n<=12;n++){
    // Both directions occur within one earned provider period, even when the
    // observed clock jumps forward past cutoff and then rolls back.
    clock.set(start+random.int(46)*DAY);const plan=n%2?'plus':'paid';Object.assign(subscription,{product_id:plan+'-product',amount:BILLING_PLANS[plan].annualAmount,modified_at:new Date(clock.now()).toISOString()});const notification=event(n);if(plan==='paid')expectedTransitions++;
    const upload=()=>f.metadata.transaction(async tx=>{const u=await tx.get('hosted-usage');await tx.put('hosted/r/upload-'+n,{size:1,version:'upload-'+n});await tx.put('hosted-usage',{bytes:u.bytes+1,objects:u.objects+1});});
    const results=await scheduler.run([
     async()=>{await billing.applyWebhook(notification);return produce();},
     async()=>{await billing.applyWebhook(notification);return produce();},
     ()=>produce(),upload,
     async()=>{const e=await episode();return f.perform(new SaveRetentionKeep({actor:owner,input:{episodeId:e.id,revision:e.keepSelectionRevision,keepSelection:random.chance(.5)?['collection:inbox']:[]}}));}
    ]);
    for(const result of results)if(result.status==='rejected')assert(['retention_conflict','retention_resolved'].includes(result.reason.code),String(result.reason.stack));
    await produce();const e=await episode(),ledger=await f.metadata.get(RETENTION_LEDGER),releases=ledger.history.filter(h=>h.resolution);
    if(e.id===current.id){assert.equal(e.deadlineAt,current.deadlineAt);assert.equal(e.effectiveAt,current.effectiveAt);}else{assert(releases.some(h=>h.id===current.id),'episode replaced without a recorded release');assert.equal(e.deadlineAt,e.noticeSchedule[0].at+30*DAY);}
    current=e;episodes.add(e.id);assert(episodes.size<=1+releases.length);assert(releases.filter(h=>h.resolution==='verified-upgrade').length<=1);assert.notEqual(e.state,'reducing');
    const transitions=await f.metadata.list({prefix:BILLING_TRANSITION_PREFIX});assert.equal(transitions.size,expectedTransitions);assert.equal(new Set([...transitions.values()].map(t=>t.causalEventId)).size,expectedTransitions);
    const replay=await billing.applyWebhook(notification);assert.equal(replay.duplicate,true);assert.equal((await f.metadata.list({prefix:BILLING_TRANSITION_PREFIX})).size,expectedTransitions);
   }
   assert.deepEqual(await f.metadata.get('hosted/r/original'),initial);assert.deepEqual(await f.metadata.get(key('message',OWNER,'m')),message);assert.equal((await f.metadata.list({prefix:'hosted/r/'})).size,13);assert.equal((await f.metadata.get('hosted-usage')).bytes,initial.size+12);assert.equal(await f.metadata.get('deletion/fence-v1'),undefined);
  }finally{await f.dispose();}
 });
});
