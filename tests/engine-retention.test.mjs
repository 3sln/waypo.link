import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER,OTHER} from './helpers/app-engine.mjs';
import {fakeClock,forEachSeed,createScheduler,injectFaults} from './helpers/chaos.mjs';
import {ProduceRetention,RetentionStatus,SaveRetentionKeep,ViewRetentionWarning,RETENTION_LEDGER,RETENTION_WARNING,SetCatalogRetentionNotice,RecordRetentionNoticeResult} from '../packages/runtime/retention.mjs';
import {OVER_QUOTA_EPISODE,OfferOverQuotaExport,claimOverQuotaExport} from '../packages/runtime/export-hooks.mjs';
import {BILLING_TRANSITION_PREFIX} from '../packages/billing/service.mjs';
import {key} from '../packages/core/records.mjs';
const DAY=86400000,HOUR=3600000,config={OVER_QUOTA_RETENTION_ENABLED:'true',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra',APP_ORIGIN:'https://retention.example'};
async function fixture(t,{seed,wrap,notice,disabled=false,adopted=true,mutable=false,extra={}}={}){
 const clock=fakeClock(),settings={...config,...disabled?{OVER_QUOTA_RETENTION_ENABLED:'false'}:{},...notice?{retentionNotice:notice}:{},...extra},f=await createTestEngine({clock,seed,wrap,config:settings,...mutable?{providers:{config:settings}}:{}});t?.after(()=>f.dispose());await f.metadata.put('owner',OWNER);
 const effectiveAt=clock.now(),system={kind:'system',owner:OWNER},owner={kind:'owner',owner:OWNER};
 const free={owner:OWNER,source:'polar',retentionAuthoritative:true,catalogVersion:2,plan:'free',billingRevision:2,reconciledAt:effectiveAt};
 await f.metadata.put('billing/state',free);await f.metadata.put('resource/r',{id:'r',owner:OWNER,provider:'hosted',name:'Whole dataset'});await f.metadata.put('hosted/r/chunk',{key:'chunk',size:600000000,version:'stable',blobRef:'private'});await f.metadata.put('hosted-usage',{bytes:600000000,objects:1});await f.metadata.put(key('collection',OWNER,'inbox'),{id:'inbox',owner:OWNER,name:'Inbox',active:true});await f.metadata.put(key('message',OWNER,'m'),{id:'m',owner:OWNER,collection:'inbox',size:10,blobRef:'private-message'});await f.metadata.put(key('message-usage',OWNER),{bytes:10,messages:1});
 const transition=(revision=2,patch={})=>({revision,causalEventId:'event-'+revision,before:{plan:'paid',storageBytes:5000000000},after:{plan:'free',storageBytes:500000000},effectiveAt,reason:'lapse',...patch});
 const push=async(t=transition())=>f.metadata.put(BILLING_TRANSITION_PREFIX+String(t.revision).padStart(16,'0'),t);
 const produce=(actor=system)=>f.perform(new ProduceRetention({actor})),status=(actor=owner)=>f.read(new RetentionStatus({actor})),keep=(ids,revision=0,episodeId)=>f.perform(new SaveRetentionKeep({actor:owner,input:{episodeId,revision,keepSelection:ids}}));
 // The flag-adoption point precedes the transition unless a test exercises backfill.
 if(adopted&&!disabled)await produce();
 await push();
 // The producer persists a step-capped observation; real time is walked one producer run at a time.
 const walk=async(until,step=DAY)=>{while(clock.now()<until){clock.set(Math.min(until,clock.now()+step));await produce();}};
 return {...f,settings,clock,effectiveAt,free,system,owner,transition,push,produce,status,keep,walk,episode:()=>f.metadata.get(OVER_QUOTA_EPISODE),ledger:()=>f.metadata.get(RETENTION_LEDGER)};
}
test('producer requires flag/system/owner binding; never infers an episode from Free',async t=>{
 const f=await fixture(t,{disabled:true});assert.equal((await f.produce()).enabled,false);assert.equal(await f.episode(),undefined);await assert.rejects(f.produce(f.owner),{code:'unauthorized'});await assert.rejects(f.status({kind:'owner',owner:OTHER}),{code:'forbidden'});
 const g=await fixture(t);await g.metadata.delete(BILLING_TRANSITION_PREFIX+String(2).padStart(16,'0'));await g.produce();assert.equal(await g.episode(),undefined);
});
test('late consumption floors the cutoff at consumption + 30 days; replay, restart and rollback keep it; eligibility is computed only',async t=>{
 // Review M1: late reconciliation gets a fresh notified episode, never a backdated cleanup.
 const f=await fixture(t);f.clock.advance(3*DAY);const consumedAt=f.clock.now();await f.produce();const e=await f.episode();assert.equal(e.effectiveAt,f.effectiveAt);assert.equal(e.deadlineAt,consumedAt+30*DAY);assert.equal(e.policyVersion,'D092-2026-10-23');assert.equal(e.exportOffered.at,consumedAt);assert.deepEqual(e.noticeSchedule.map(n=>n.at),[consumedAt,consumedAt+23*DAY,consumedAt+29*DAY]);
 await f.produce();assert.equal((await f.episode()).id,e.id);assert.equal((await f.episode()).deadlineAt,e.deadlineAt);
 await f.perform(new OfferOverQuotaExport({actor:f.system,input:{episodeId:e.id,expectedRevision:(await f.episode()).revision}}));assert.equal((await f.episode()).deadlineAt,e.deadlineAt);
 await f.metadata.transaction(tx=>claimOverQuotaExport(tx,{owner:OWNER,episodeId:e.id,jobId:'00000000-0000-4000-8000-000000000001',now:f.clock.now()}));
 await f.walk(e.deadlineAt);assert.equal((await f.episode()).state,'cleanup-eligible');f.clock.set(f.effectiveAt);await f.produce();assert.equal((await f.episode()).state,'cleanup-eligible');assert.equal((await f.episode()).deadlineAt,e.deadlineAt);assert.equal((await f.status()).removalEnabled,false);assert.equal(await f.metadata.get('deletion/fence-v1'),undefined);
});
test('flag adoption: transitions recorded while the flag was off start a fresh backfill episode, not backdated cleanup',async t=>{
 const f=await fixture(t,{adopted:false});f.clock.advance(60*DAY);const now=f.clock.now();await f.produce();const e=await f.episode();
 assert.equal(e.backfill,true);assert.equal(e.effectiveAt,now);assert.equal(e.deadlineAt,now+30*DAY);assert.equal(e.state,'grace');assert.equal((await f.ledger()).history[0].outcome,'backfill');assert.equal((await f.ledger()).adoption.at,now);
 assert.deepEqual(e.noticeSchedule.map(n=>n.attempts.length),[1,0,0]);assert.equal(e.noticeSchedule.some(n=>n.skipped),false);
});
test('late lapse after adoption: deadline floored, past notice slots are skipped rather than fired together',async t=>{
 const f=await fixture(t);await f.push(f.transition(2,{effectiveAt:f.effectiveAt-40*DAY}));await f.produce();let e=await f.episode();
 assert.equal(e.effectiveAt,f.effectiveAt-40*DAY);assert.equal(e.deadlineAt,f.effectiveAt+30*DAY);assert.equal(e.state,'grace');assert.deepEqual(e.noticeSchedule.map(n=>n.attempts.length),[1,0,0]);
 // A raw clock jump fires nothing early: notice due times follow the step-capped observation (L5).
 f.clock.set(f.effectiveAt+29*DAY+HOUR);const lagging=await f.produce();e=await f.episode();assert.deepEqual(e.noticeSchedule.map(n=>n.attempts.length),[1,0,0]);
 // N6: the lagging observation asks for one corroborating reading a minute later, then catches up to the first
 // reading; only the latest due slot is attempted.
 assert.equal(lagging.wakeAt,f.clock.now()+60000);f.clock.advance(60000);await f.produce();e=await f.episode();assert.equal(e.noticeSchedule[1].skipped.reason,'superseded');assert.equal(e.noticeSchedule[1].attempts.length,0);assert.equal(e.noticeSchedule[2].attempts.length,1);assert.equal(e.state,'grace');
});
test('default notice records not-configured separately from viewed; every schedule has persistent attempts',async t=>{
 const f=await fixture(t);await f.produce();let e=await f.episode();assert.equal(e.noticeSchedule[0].attempts[0].result,'not-configured');assert.equal(e.noticeSchedule[0].attempts[0].acceptedAt,undefined);await f.produce();assert.equal((await f.episode()).noticeSchedule[0].attempts.length,1);
 await f.perform(new ViewRetentionWarning({actor:f.owner}));e=await f.episode();assert.equal(e.viewedAt,f.clock.now());assert.equal((await f.metadata.get(RETENTION_WARNING)).viewedAt,e.viewedAt);assert.equal(e.noticeSchedule[0].attempts[0].deliveredAt,undefined);
 assert.equal(e.noticeSchedule[0].attempts[0].attemptedAt,undefined);assert.equal(e.noticeSchedule[0].attempts[0].checkedAt,f.effectiveAt);await f.walk(f.effectiveAt+29*DAY);assert.deepEqual((await f.episode()).noticeSchedule.map(n=>n.attempts.length),[1,1,1]);
});
test('trusted notice port retries failure with original deadline and keeps delivery evidence separate',async t=>{
 let calls=[];const f=await fixture(t,{notice:async input=>{calls.push(input);if(calls.length===1)throw Error('offline');return {result:'accepted',acceptedAt:input.scheduledAt};}});await f.produce();f.clock.advance(60000);await f.produce();assert.equal(calls.length,2);assert.equal(calls[0].deadlineAt,calls[1].deadlineAt);assert.notEqual(calls[0].idempotencyKey,calls[1].idempotencyKey);const a=(await f.episode()).noticeSchedule[0].attempts;assert.equal(a[0].result,'failed');assert.equal(a[1].result,'accepted');assert.equal(a[1].deliveredAt,undefined);await f.produce();assert.equal(calls.length,2);
});
test('whole unit owner inventory hides private refs and validates fresh quota and selection revision',async t=>{
 const f=await fixture(t);await f.produce();const s=await f.status();assert.equal(s.inventoryComplete,true);assert.deepEqual(s.units.map(u=>[u.id,u.bytes]),[['collection:inbox',10],['resource:r',600000000]]);assert(!JSON.stringify(s).includes('private'));assert.equal(s.storageDebtBytes,100000010);assert.equal(s.physicalRetainedBytes,null);
 const id=s.episode.id;await assert.rejects(f.keep(['resource:r'],0,id),{code:'keep_selection_too_large'});await f.keep(['collection:inbox'],0,id);assert.equal((await f.episode()).keepSelectionRevision,1);await assert.rejects(f.keep([],0,id),{code:'retention_conflict'});await f.keep(['collection:inbox'],1,id);assert.equal((await f.episode()).keepSelectionRevision,1);await assert.rejects(f.keep(['collection:missing'],1,id),{code:'invalid_keep_selection'});
 // Bytes that no longer reconcile make fit unknown rather than blocking a whole-unit choice (N2).
 await f.metadata.put('hosted/r/new',{size:1});const saved=await f.keep([],1,id);assert.equal(saved.fit,'unknown');assert.equal(saved.bytes,null);const unknown=await f.status();assert.equal(unknown.inventoryBytesKnown,false);assert.equal(unknown.keepSelectionFit,'unknown');assert.equal(unknown.keepSelectionInfeasible,false);
});
test('usage-fit resolution and repeated toggles retain funded cutoff, including beyond bounded history',async t=>{
 const f=await fixture(t);await f.produce();const before=await f.episode();await f.metadata.put('hosted-usage',{bytes:0,objects:0});await f.produce();assert.equal((await f.episode()).state,'resolved');await f.metadata.put('hosted-usage',{bytes:600000000,objects:1});
 for(let n=3;n<45;n++){f.clock.advance(DAY);await f.push(f.transition(n,{effectiveAt:f.clock.now()}));await f.produce();}const e=await f.episode();assert.equal(e.id,before.id);assert.equal(e.deadlineAt,before.deadlineAt);assert.equal((await f.metadata.get(RETENTION_LEDGER)).history.length,32);
});
const paidState=(f,revision,patch={})=>({...f.free,catalogVersion:2,plan:'paid',validUntil:f.clock.now()+365*DAY,subscriptionId:'sub',billingRevision:revision,periodStart:f.effectiveAt-DAY,...patch});
test('verified mid-period upgrade releases the funded anchor; a quick second toggle inside the window does not',async t=>{
 const f=await fixture(t);await f.produce();const a=await f.episode();f.clock.advance(2*DAY);await f.metadata.put('billing/state',paidState(f,3));await f.produce();
 assert.equal((await f.episode()).state,'resolved');assert.equal((await f.ledger()).anchor,null);assert.equal((await f.ledger()).history.at(-1).resolution,'verified-upgrade');assert.equal((await f.episode()).releaseReason,'verified-upgrade');
 f.clock.advance(DAY);await f.metadata.put('billing/state',{...f.free,billingRevision:4});await f.push(f.transition(4,{effectiveAt:f.clock.now()}));await f.produce();const b=await f.episode();assert.notEqual(b.id,a.id);assert.equal(b.deadlineAt,f.clock.now()+30*DAY);
 // Replaced evidence survives as bounded history (L7).
 assert.equal((await f.ledger()).episodes[0].id,a.id);assert.equal((await f.ledger()).episodes[0].noticeSchedule[0].attempts.length,1);
 f.clock.advance(DAY);await f.metadata.put('billing/state',paidState(f,5));await f.produce();assert.equal((await f.ledger()).anchor.id,b.id);
 f.clock.advance(DAY);await f.metadata.put('billing/state',{...f.free,billingRevision:6});await f.push(f.transition(6,{effectiveAt:f.clock.now()}));await f.produce();f.clock.advance(60000);await f.produce();const c=await f.episode();assert.equal(c.id,b.id);assert.equal(c.deadlineAt,b.deadlineAt);assert.equal(c.state,'grace');
});
test('thirty days of continuous adequate paid entitlement releases the anchor even when purchases are rate-bounded',async t=>{
 const f=await fixture(t);await f.push(f.transition(2,{reason:'catalog'}));await f.produce();await f.perform(new SetCatalogRetentionNotice({actor:f.system,input:{billingRevision:2,noticeAt:f.clock.now()+10*DAY}}));await f.produce();const e=await f.episode();assert.equal(e.deadlineAt,f.clock.now()+40*DAY);
 await f.metadata.transaction(async tx=>{const l=await tx.get(RETENTION_LEDGER);await tx.put(RETENTION_LEDGER,{...l,lastPurchaseReleaseAt:f.clock.now()});});
 await f.metadata.put('billing/state',paidState(f,3));await f.produce();assert.equal((await f.ledger()).anchor.id,e.id);
 await f.walk(f.clock.now()+29*DAY);assert.equal((await f.ledger()).anchor.id,e.id);await f.walk(f.clock.now()+DAY);assert.equal((await f.ledger()).anchor,null);assert.equal((await f.ledger()).history.at(-1).resolution,'sustained-paid');
});
test('a cutoff that passed while the account fitted its quota is never reused',async t=>{
 const f=await fixture(t);await f.produce();const a=await f.episode();await f.perform(new ViewRetentionWarning({actor:f.owner}));await f.metadata.put('hosted-usage',{bytes:0,objects:0});await f.produce();assert.equal((await f.episode()).state,'resolved');assert((await f.ledger()).anchor);
 f.clock.set(a.deadlineAt+DAY);await f.metadata.put('hosted-usage',{bytes:600000000,objects:1});await f.push(f.transition(3,{effectiveAt:f.clock.now()}));
 // N3/N6: after a long gap the reduction waits for one corroborating reading before deciding on the anchor.
 const deferred=await f.produce();assert.equal(deferred.corroborate,true);assert.equal((await f.episode()).id,a.id);assert.equal((await f.episode()).state,'resolved');f.clock.advance(60000);await f.produce();const b=await f.episode();
 assert.notEqual(b.id,a.id);assert.equal(b.deadlineAt,f.clock.now()+30*DAY);assert.equal(b.state,'grace');assert.equal((await f.ledger()).history.find(h=>h.resolution)?.resolution,'deadline-passed-fitting');
 const prior=(await f.ledger()).episodes.at(-1);assert.equal(prior.id,a.id);assert.equal(prior.viewedAt,a.viewedAt??prior.viewedAt);assert.ok(Number.isSafeInteger(prior.viewedAt));
});
test('catalog shrink records history without retroactive episode; explicit future operator date starts fresh notice',async t=>{
 const f=await fixture(t);await f.push(f.transition(2,{reason:'catalog',effectiveAt:f.clock.now()-100*DAY}));await f.produce();assert.equal(await f.episode(),undefined);assert.equal((await f.metadata.get(RETENTION_LEDGER)).history[0].outcome,'catalog-notice-required');
 const notice={billingRevision:2,noticeAt:f.clock.now()+DAY};await assert.rejects(f.perform(new SetCatalogRetentionNotice({actor:f.owner,input:notice})),{code:'unauthorized'});await f.perform(new SetCatalogRetentionNotice({actor:f.system,input:notice}));await f.produce();assert.equal((await f.episode()).deadlineAt,f.clock.now()+31*DAY);await f.perform(new SetCatalogRetentionNotice({actor:f.system,input:notice}));await assert.rejects(f.perform(new SetCatalogRetentionNotice({actor:f.system,input:{...notice,noticeAt:notice.noticeAt+DAY}})),{code:'retention_conflict'});
});
test('ambiguous billing and corrupt accounting pause policy without consuming transitions or moving deadlines',async t=>{
 const f=await fixture(t);await f.produce();const e=await f.episode();await f.metadata.put('billing/state',{...f.free,plan:'paid',catalogVersion:3,origin:'https://wrong.example'});await f.produce();assert.equal((await f.episode()).state,'paused-safety');assert.equal((await f.episode()).deadlineAt,e.deadlineAt);
 await f.metadata.put('billing/state',f.free);await f.metadata.put('hosted-usage',{bytes:-1,objects:1});await f.produce();assert.equal((await f.episode()).state,'paused-safety');assert.equal((await f.metadata.get(RETENTION_WARNING)).state,'paused-safety');
});
test('seeded replay/toggle/clock/upload/keep chaos preserves cutoff, idempotency and every content row',async()=>{
 await forEachSeed(20,async random=>{const scheduler=createScheduler(random),f=await fixture(null,{seed:random.seed,wrap:{accountStore:s=>scheduler.wrap(s,'retention-store')}});try{await f.produce();const e=await f.episode(),original=await f.metadata.get('hosted/r/chunk'),message=await f.metadata.get(key('message',OWNER,'m'));for(let n=0;n<12;n++){
  f.clock.set(f.effectiveAt+random.int(45)*DAY);const revision=n+3;
  await scheduler.run([()=>f.push(f.transition(revision,{effectiveAt:f.clock.now()})).then(()=>f.produce()),()=>f.produce(),()=>f.metadata.transaction(async tx=>{const u=await tx.get('hosted-usage');await tx.put('hosted/r/upload'+n,{size:1,version:'v'+n});await tx.put('hosted-usage',{bytes:u.bytes+1,objects:u.objects+1});}),async()=>{const current=await f.episode();return f.keep(random.chance(.5)?['collection:inbox']:[],current.keepSelectionRevision,e.id);}]);
  const current=await f.episode();assert.equal(current.id,e.id);assert.equal(current.deadlineAt,e.deadlineAt);assert.notEqual(current.state,'reducing');
 }assert.deepEqual(await f.metadata.get('hosted/r/chunk'),original);assert.deepEqual(await f.metadata.get(key('message',OWNER,'m')),message);assert.equal((await f.metadata.list({prefix:'hosted/r/'})).size,13);assert.equal(await f.metadata.get('deletion/fence-v1'),undefined);
 }finally{await f.dispose();}});
});

test('notice evidence callbacks are system-only and idempotently preserve independent delivery/bounce/view facts',async t=>{
 const f=await fixture(t,{notice:async()=>({result:'accepted'})});await f.produce();const e=await f.episode(),attempt=e.noticeSchedule[0].attempts[0],input={episodeId:e.id,attemptId:attempt.id,result:'delivered',at:f.clock.now()};assert.equal(attempt.result,'accepted');await assert.rejects(f.perform(new RecordRetentionNoticeResult({actor:f.owner,input})),{code:'unauthorized'});await f.perform(new RecordRetentionNoticeResult({actor:f.system,input}));const revision=(await f.episode()).revision;await f.perform(new RecordRetentionNoticeResult({actor:f.system,input}));assert.equal((await f.episode()).revision,revision);const a=(await f.episode()).noticeSchedule[0].attempts[0];assert.equal(a.deliveredAt,f.clock.now());assert.equal(a.acceptedAt,undefined);assert.equal(a.viewedAt,undefined);assert.equal((await f.metadata.get(RETENTION_WARNING)).viewedAt,null);
});
test('notice evidence is refused for not-configured, failed and pending attempts; port timestamps are bounded',async t=>{
 const f=await fixture(t);await f.produce();const e=await f.episode(),attempt=e.noticeSchedule[0].attempts[0];assert.equal(attempt.result,'not-configured');
 for(const result of ['delivered','accepted'])await assert.rejects(f.perform(new RecordRetentionNoticeResult({actor:f.system,input:{episodeId:e.id,attemptId:attempt.id,result,at:f.clock.now()}})),{code:'invalid_notice_result'});
 let reply;const g=await fixture(t,{notice:async input=>reply(input)});
 reply=()=>{throw Error('offline');};await g.produce();let ge=await g.episode();const failed=ge.noticeSchedule[0].attempts[0];assert.equal(failed.result,'failed');await assert.rejects(g.perform(new RecordRetentionNoticeResult({actor:g.system,input:{episodeId:ge.id,attemptId:failed.id,result:'delivered',at:g.clock.now()}})),{code:'invalid_notice_result'});
 await g.metadata.transaction(async tx=>{const x=await tx.get(OVER_QUOTA_EPISODE);x.noticeSchedule[0].attempts.push({id:x.id+':0:9',attemptedAt:g.clock.now(),result:'pending',retryAt:g.clock.now()+HOUR});await tx.put(OVER_QUOTA_EPISODE,x);});
 await assert.rejects(g.perform(new RecordRetentionNoticeResult({actor:g.system,input:{episodeId:ge.id,attemptId:ge.id+':0:9',result:'accepted',at:g.clock.now()}})),{code:'invalid_notice_result'});
 const h=await fixture(t,{notice:async input=>({result:'accepted',acceptedAt:h.clock.now(),deliveredAt:h.clock.now()+HOUR,bouncedAt:input.scheduledAt-1})});await h.produce();const a=(await h.episode()).noticeSchedule[0].attempts[0];assert.equal(a.result,'accepted');assert.equal(a.acceptedAt,h.clock.now());assert.equal(a.deliveredAt,undefined);assert.equal(a.bouncedAt,undefined);
});
test('not-configured is not terminal: an absent port is re-asked once configured, a declining port after a day',async t=>{
 const f=await fixture(t,{mutable:true});await f.produce();let n=(await f.episode()).noticeSchedule[0];assert.deepEqual(n.attempts.map(a=>[a.result,a.port,a.checkedAt,a.attemptedAt]),[['not-configured','absent',f.clock.now(),undefined]]);
 await f.produce();assert.equal((await f.episode()).noticeSchedule[0].attempts.length,1);
 let answer='not-configured';const calls=[];f.settings.retentionNotice=async input=>{calls.push(input.idempotencyKey);return {result:answer};};
 await f.produce();n=(await f.episode()).noticeSchedule[0];assert.equal(calls.length,1);assert.equal(n.attempts.at(-1).port,'declined');await f.produce();assert.equal(calls.length,1);
 answer='accepted';f.clock.advance(DAY);await f.produce();n=(await f.episode()).noticeSchedule[0];assert.equal(calls.length,2);assert.equal(n.attempts.at(-1).result,'accepted');await f.produce();assert.equal(calls.length,2);
});
test('one future clock reading cannot make an episode cleanup-eligible for good',async t=>{
 const f=await fixture(t);await f.produce();f.clock.set(f.effectiveAt+400*DAY);await f.produce();f.clock.set(f.effectiveAt+2*DAY);await f.produce();assert.equal((await f.episode()).state,'grace');assert.ok((await f.episode()).observedAt<=f.effectiveAt+2*DAY);
});
test('a malformed transition without an episode is skipped with an operator alert instead of stalling the cursor',async t=>{
 const f=await fixture(t);await f.push(f.transition(2,{effectiveAt:'invalid'}));await f.push(f.transition(3));const result=await f.produce();
 assert.deepEqual(result.alerts.map(a=>[a.kind,a.action,a.reason]),[['over-quota-retention','operator-alert','malformed-transition']]);assert.equal((await f.ledger()).cursor,BILLING_TRANSITION_PREFIX+String(3).padStart(16,'0'));assert.equal((await f.episode()).causalBillingRevision,3);assert.equal((await f.ledger()).history.some(h=>h.outcome==='malformed-skipped'),true);
});
test('unchanged producer runs do not write; observation-only advances never bump the revision',async t=>{
 const f=await fixture(t);await f.produce();const e=await f.episode(),ledger=await f.ledger(),warning=await f.metadata.get(RETENTION_WARNING);
 f.clock.advance(10*60000);await f.produce();await f.status();assert.deepEqual(await f.episode(),e);assert.deepEqual(await f.ledger(),ledger);assert.deepEqual(await f.metadata.get(RETENTION_WARNING),warning);
 f.clock.advance(2*HOUR);await f.produce();const later=await f.episode();assert.equal(later.revision,e.revision);assert.equal(later.observedAt,f.clock.now());
});
test('owner view stamps only an active warning, once',async t=>{
 const f=await fixture(t);await f.produce();await f.perform(new ViewRetentionWarning({actor:f.owner}));const e=await f.episode();f.clock.advance(HOUR);await f.perform(new ViewRetentionWarning({actor:f.owner}));assert.deepEqual(await f.episode(),e);
 const g=await fixture(t);await g.produce();await g.metadata.put('hosted-usage',{bytes:0,objects:0});await g.produce();const resolved=await g.episode();assert.equal(resolved.state,'resolved');assert.deepEqual(await g.perform(new ViewRetentionWarning({actor:g.owner})),{viewed:false});assert.deepEqual(await g.episode(),resolved);
});
test('flag off: owner actions refuse and status answers not_found unless an episode is persisted',async t=>{
 const on=await fixture(t);await on.produce();const episode=await on.episode();
 const f=await fixture(t,{disabled:true});await assert.rejects(f.status(),{code:'not_found',status:404});await assert.rejects(f.keep([],0,episode.id),{code:'not_found'});await assert.rejects(f.perform(new ViewRetentionWarning({actor:f.owner})),{code:'not_found'});await assert.rejects(f.perform(new SetCatalogRetentionNotice({actor:f.system,input:{billingRevision:2,noticeAt:f.clock.now()+DAY}})),{code:'not_found'});
 await f.metadata.put(OVER_QUOTA_EPISODE,episode);const s=await f.status();assert.equal(s.episode.id,episode.id);assert.equal(s.removalEnabled,false);await assert.rejects(f.keep([],0,episode.id),{code:'not_found'});assert.deepEqual(await f.episode(),episode);
});
test('large inventories keep whole-unit choice: row-limited bytes are unknown, an aggregate port gives exact bytes',async t=>{
 // N2: an inbox above the scan limit is not a dead end.
 const f=await fixture(t,{extra:{retentionInventoryRowLimit:2}});await f.produce();let s=await f.status();assert.equal(s.inventoryTruncated,false);assert.equal(s.inventoryBytesKnown,false);assert.deepEqual(s.units.map(u=>[u.id,u.bytes]),[['collection:inbox',null],['resource:r',null]]);assert.equal(s.keepSelectionFit,'unknown');
 const saved=await f.keep(['resource:r'],0,s.episode.id);assert.equal(saved.fit,'unknown');assert.deepEqual((await f.episode()).keepSelection,['resource:r']);await assert.rejects(f.keep(['collection:missing'],1,s.episode.id),{code:'invalid_keep_selection'});
 const g=await fixture(t,{extra:{retentionInventoryRowLimit:2,retentionUnitBytes:async owner=>owner===OWNER?{resources:{r:600000000},collections:{inbox:10}}:null}});await g.produce();s=await g.status();assert.equal(s.inventorySource,'aggregate');assert.equal(s.inventoryBytesKnown,true);assert.deepEqual(s.units.map(u=>[u.id,u.bytes]),[['collection:inbox',10],['resource:r',600000000]]);
 await assert.rejects(g.keep(['resource:r'],0,s.episode.id),{code:'keep_selection_too_large'});assert.equal((await g.keep(['collection:inbox'],0,s.episode.id)).fit,'fits');
 const h=await fixture(t,{extra:{retentionUnitBytes:async()=>({resources:{unknown:5},collections:{}})}});await h.produce();s=await h.status();assert.equal(s.inventoryBytesKnown,false);assert.equal(s.inventorySource,'aggregate-membership');
 // The remaining limit: more unit records than the row limit cannot be validated.
 const k=await fixture(t,{extra:{retentionInventoryRowLimit:1}});await k.produce();s=await k.status();assert.equal(s.inventoryTruncated,true);assert.deepEqual(s.units,[]);await assert.rejects(k.keep([],0,s.episode.id),{code:'retention_inventory_too_large'});
});
for(const [label,hold]of [['~1-day',DAY/2],['8-day',8*DAY]])test(`a ${label} paid hold across each deadline cannot keep renewing grace (review N1 probe)`,async t=>{
 const f=await fixture(t);await f.produce();let e=await f.episode();const deadlines=[e.deadlineAt];let revision=3;
 for(let cycle=0;cycle<4;cycle++){
  const d=(await f.ledger()).anchor?.deadlineAt??e.deadlineAt;await f.walk(d-hold,DAY/2);await f.metadata.put('billing/state',paidState(f,revision++));await f.walk(d+DAY/2,HOUR*6);
  await f.metadata.put('billing/state',{...f.free,billingRevision:revision});await f.push(f.transition(revision++,{effectiveAt:f.clock.now()}));await f.produce();f.clock.advance(60000);await f.produce();e=await f.episode();deadlines.push(e.deadlineAt);
 }
 const releases=(await f.ledger()).history.filter(h=>h.resolution);assert.deepEqual(releases.map(h=>h.resolution),['verified-upgrade']);assert.equal(new Set(deadlines).size,2,JSON.stringify(deadlines.map(d=>(d-f.effectiveAt)/DAY)));
});
test('reducing stored bytes releases a passed cutoff only when the account fitted at least seven days before it',async t=>{
 const f=await fixture(t);await f.produce();const a=await f.episode();f.clock.set(a.deadlineAt-6*DAY);await f.produce();await f.metadata.put('hosted-usage',{bytes:0,objects:0});await f.walk(a.deadlineAt+DAY);
 await f.metadata.put('hosted-usage',{bytes:600000000,objects:1});await f.push(f.transition(3,{effectiveAt:f.clock.now()}));await f.produce();f.clock.advance(60000);await f.produce();assert.equal((await f.episode()).id,a.id);assert.equal((await f.ledger()).anchor.id,a.id);
});
test('a single far-future reading cannot release a funded anchor (anchor release uses the capped observation)',async t=>{
 const f=await fixture(t);await f.produce();const a=await f.episode();await f.metadata.put('hosted-usage',{bytes:0,objects:0});await f.produce();
 f.clock.set(f.effectiveAt+400*DAY);await f.produce();f.clock.set(f.effectiveAt+2*DAY);await f.produce();assert.equal((await f.ledger()).anchor?.id,a.id);assert.equal((await f.ledger()).history.some(h=>h.resolution),false);
});
test('after downtime the observation catches up on a corroborating reading and the cutoff is never earlier than real time',async t=>{
 const f=await fixture(t);await f.produce();const e=await f.episode();f.clock.set(e.deadlineAt+HOUR);const first=await f.produce();assert.equal((await f.episode()).state,'grace');assert.equal(first.wakeAt,f.clock.now()+60000);
 f.clock.advance(60000);await f.produce();const caught=await f.episode();assert.equal(caught.state,'cleanup-eligible');assert.ok(caught.observedAt<=f.clock.now()&&caught.observedAt>=e.deadlineAt);
});
test('lost producer reply retries the committed episode without resetting funding or notices',async t=>{
 const f=await fixture(t,{adopted:false,wrap:{accountStore:s=>injectFaults(s,[{method:'transaction',when:1,mode:'after'}])}});await assert.rejects(f.produce(),{code:'injected_fault'});const committed=await f.episode();f.clock.advance(DAY);await f.produce();const retried=await f.episode();assert.equal(retried.id,committed.id);assert.equal(retried.deadlineAt,committed.deadlineAt);assert.equal((await f.metadata.get(RETENTION_LEDGER)).history.length,1);assert.equal(retried.noticeSchedule[0].attempts.length,1);
});
test('invalid transition pauses both episode and warning without consuming billing cursor',async t=>{
 const f=await fixture(t);await f.produce();const before=await f.episode(),cursor=(await f.metadata.get(RETENTION_LEDGER)).cursor;await f.push(f.transition(3,{effectiveAt:'invalid'}));await f.produce();assert.equal((await f.episode()).state,'paused-safety');assert.equal((await f.metadata.get(RETENTION_WARNING)).state,'paused-safety');assert.equal((await f.metadata.get(RETENTION_LEDGER)).cursor,cursor);assert.equal((await f.episode()).deadlineAt,before.deadlineAt);
});
