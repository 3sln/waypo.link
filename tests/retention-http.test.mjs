import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNodeServer} from '../apps/node/server.mjs';
import {BILLING_TRANSITION_PREFIX} from '../packages/billing/service.mjs';
import {OVER_QUOTA_EPISODE} from '../packages/runtime/export-hooks.mjs';
import {key} from '../packages/core/records.mjs';
import {softAuthenticator,registerPending} from './helpers/soft-passkey.mjs';
const DAY=86400000;
test('Node retention HTTP is owner/CSRF protected and persists deadline/keep/evidence across restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-')),origin='http://localhost:8788',now=Date.now(),config={APP_ORIGIN:origin,OVER_QUOTA_RETENTION_ENABLED:'true',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra',LIFECYCLE_CLOCK:()=>now};let app;
 try{
  app=await createNodeServer({directory,config});
  const post=(path,input,headers={})=>app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}));
  const pending=await(await post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();await registerPending(softAuthenticator({origin}),async(path,input)=>(await post(path,input)).json(),pending);
  const recovery=await(await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
  const activation=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await activation.json(),cookie=activation.headers.get('Set-Cookie').split(';')[0],owner=session.account.id,c=app.resources.accounts.get(owner);await c.warm(owner);
  const resource=(await c.metadata.get('builtin/hosted-resource-v1')).id;
  const dataset={size:600000000,key:'dataset',version:'immutable',blobRef:'private'};await c.metadata.put('hosted/'+resource+'/dataset',dataset);c.itemIndex.upsertObject(resource,dataset);await c.metadata.put('hosted-usage',{bytes:600000000,objects:1});
  await c.metadata.put('billing/state',{owner,source:'polar',catalogVersion:2,plan:'free',billingRevision:2,retentionAuthoritative:true,reconciledAt:now});
  await c.metadata.put('billing/sync',{checked:true,checkedAt:now});
  await c.metadata.put(BILLING_TRANSITION_PREFIX+String(2).padStart(16,'0'),{revision:2,causalEventId:'verified-lapse',before:{plan:'paid',storageBytes:5000000000},after:{plan:'free',storageBytes:500000000},effectiveAt:now-2*DAY,reason:'lapse'});
  const get=()=>app.fetch(new Request(origin+'/api/account/retention',{headers:{Cookie:cookie}}));
  assert.equal((await app.fetch(new Request(origin+'/api/account/retention'))).status,401);
  let response=await get();assert.equal(response.status,200,await response.clone().text());const state=await response.json();assert.ok(state.episode,JSON.stringify({state,produced:await c.retentionProduce(owner),sync:await c.metadata.get('billing/sync'),flag:c.config.OVER_QUOTA_RETENTION_ENABLED,billing:c.config.BILLING_ENABLED}));assert.equal(state.episode.deadlineAt,now+30*DAY);assert.equal(state.episode.backfill,true);assert.equal(state.units.find(u=>u.id==='resource:'+resource).bytes,600000000);assert.equal(state.inventorySource,'aggregate');assert.equal(state.inventoryBytesKnown,true);assert.equal(state.removalEnabled,false);
  const input={episodeId:state.episode.id,revision:0,keepSelection:[]};assert.equal((await post('/api/account/retention/keep',input,{Cookie:cookie})).status,403);
  const headers={Cookie:cookie,'X-CSRF-Token':session.csrfToken};assert.equal((await post('/api/account/retention/keep',input,headers)).status,200);assert.equal((await post('/api/account/retention/viewed',{},headers)).status,200);
  const before=await c.metadata.get(OVER_QUOTA_EPISODE);await app.close();app=await createNodeServer({directory,config});response=await get();assert.equal(response.status,200);const after=await response.json();assert.equal(after.episode.id,before.id);assert.equal(after.episode.deadlineAt,before.deadlineAt);assert.equal(after.episode.viewedAt,before.viewedAt);assert.equal(after.episode.noticeSchedule[0].attempts.length,1);assert.equal(after.episode.noticeSchedule[0].attempts[0].result,'not-configured');assert.equal((await app.resources.accounts.get(owner).metadata.list({prefix:'hosted/'+resource+'/'})).size,1);
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});

async function account(config,directory){
 const origin=config.APP_ORIGIN,app=await createNodeServer({directory,config});
 const post=(path,input,headers={})=>app.fetch(new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}));
 const pending=await(await post('/api/auth/signup',{method:'passkey',ageConfirmed:18,termsAccepted:true,termsVersion:'2026-10-11',turnstileToken:'local-browser-test-token'})).json();await registerPending(softAuthenticator({origin}),async(path,input)=>(await post(path,input)).json(),pending);
 const recovery=await(await post('/api/auth/recovery/download',{pendingToken:pending.pendingToken})).json();
 const activation=await post('/api/auth/recovery/confirm',{pendingToken:pending.pendingToken,recoveryToken:recovery.recoveryToken,downloadConfirmed:true}),session=await activation.json(),cookie=activation.headers.get('Set-Cookie').split(';')[0],owner=session.account.id,c=app.resources.accounts.get(owner);await c.warm(owner);
 const headers={Cookie:cookie,'X-CSRF-Token':session.csrfToken};
 return {app,owner,c,get:()=>app.fetch(new Request(origin+'/api/account/retention',{headers:{Cookie:cookie}})),post:(path,input)=>post(path,input,headers)};
}
const base=now=>({APP_ORIGIN:'http://localhost:8788',ACCOUNT_EXPORT_ENABLED:'true',BILLING_ENABLED:'true',POLAR_SERVER:'sandbox',POLAR_ACCESS_TOKEN:'offline',POLAR_WEBHOOK_SECRET:'offline',POLAR_PRODUCT_ID_PAID:'paid',POLAR_PRODUCT_ID_PLUS:'plus',POLAR_PRODUCT_ID_ULTRA:'ultra',LIFECYCLE_CLOCK:()=>now});
async function seedLapse(c,owner,now){
 const resource=(await c.metadata.get('builtin/hosted-resource-v1')).id;
 await c.metadata.put('hosted/'+resource+'/dataset',{size:600000000,key:'dataset',version:'immutable',blobRef:'private'});await c.metadata.put('hosted-usage',{bytes:600000000,objects:1});
 await c.metadata.put('billing/state',{owner,source:'polar',catalogVersion:2,plan:'free',billingRevision:2,retentionAuthoritative:true,reconciledAt:now});await c.metadata.put('billing/sync',{checked:true,checkedAt:now});
 await c.metadata.put(BILLING_TRANSITION_PREFIX+String(2).padStart(16,'0'),{revision:2,causalEventId:'verified-lapse',before:{plan:'paid',storageBytes:5000000000},after:{plan:'free',storageBytes:500000000},effectiveAt:now,reason:'lapse'});
}
test('flag off: retention routes answer the uniform not_found unless an episode is persisted, which stays read-only',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-off-')),now=Date.now();let a;
 try{
  a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'false'},directory);
  for(const response of [await a.get(),await a.post('/api/account/retention/keep',{episodeId:'00000000-0000-4000-8000-000000000001',revision:0,keepSelection:[]}),await a.post('/api/account/retention/viewed',{})]){assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'not_found'});}
  await seedLapse(a.c,a.owner,now);assert.equal((await a.get()).status,404);assert.equal(await a.c.metadata.get(OVER_QUOTA_EPISODE),undefined);
  const episode={v:1,id:'00000000-0000-4000-8000-000000000002',owner:a.owner,revision:3,policyVersion:'D092-2026-10-23',effectiveAt:now,deadlineAt:now+30*DAY,state:'resolved',noticeSchedule:[],keepSelection:[],keepSelectionRevision:0};await a.c.metadata.put(OVER_QUOTA_EPISODE,episode);
  const response=await a.get();assert.equal(response.status,200);assert.equal((await response.json()).episode.id,episode.id);
  assert.equal((await a.post('/api/account/retention/keep',{episodeId:episode.id,revision:0,keepSelection:[]})).status,404);assert.equal((await a.post('/api/account/retention/viewed',{})).status,404);assert.deepEqual(await a.c.metadata.get(OVER_QUOTA_EPISODE),episode);
 }finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
test('retention routes have a per-owner activity budget',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-budget-')),now=Date.now();let a;
 try{a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'true'},directory);const statuses=[];for(let n=0;n<31;n++)statuses.push((await a.get()).status);assert.deepEqual(statuses.slice(0,30),Array(30).fill(200));assert.equal(statuses[30],429);}
 finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
test('the retention alarm never warms a shelved account and schedules nothing without retention work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-alarm-')),now=Date.now();let a;
 try{
  a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'true'},directory);const {c,owner}=a,warms=[],alarms=[];
  c.warm=async()=>{warms.push(Date.now());};const schedule=c.scheduleAlarm.bind(c);c.scheduleAlarm=async time=>{alarms.push(time);return schedule(time);};
  await c.metadata.put('shelved',true);
  assert.equal(await c.retentionAlarm(),undefined);assert.deepEqual(alarms,[]);assert.deepEqual(warms,[]);assert.equal(await c.metadata.get('shelved'),true);
  await seedLapse(c,owner,now);const result=await c.retentionAlarm();assert.equal(result.enabled,true);const episode=await c.metadata.get(OVER_QUOTA_EPISODE);assert.equal(episode.state,'grace');
  assert.deepEqual(warms,[]);assert.equal(await c.metadata.get('shelved'),true);assert.equal(alarms.length,1);assert.equal(alarms[0],now+6*3600000);assert.equal(result.wakeAt,alarms[0]);
 }finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
test('an inbox above the scan limit gets exact unit bytes from the item-index aggregate on Node (review N2)',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-aggregate-')),now=Date.now();let a;
 try{
  a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'true',retentionInventoryRowLimit:4},directory);const {c,owner}=a;await seedLapse(c,owner,now);
  const resource=(await c.metadata.get('builtin/hosted-resource-v1')).id;c.itemIndex.upsertObject(resource,{size:600000000,key:'dataset',version:'immutable',blobRef:'private'});
  const inbox=(await c.items.collections(owner))[0];let bytes=0;for(let n=0;n<12;n++){const m={id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),owner,collection:inbox.id,size:100+n,receivedAt:now+n,unread:true,blobRef:'m'+n};bytes+=m.size;await c.metadata.put(key('app-message',owner,m.id),m);c.itemIndex.upsert(m);}
  await c.metadata.put(key('app-message-usage',owner),{bytes,messages:12});await c.metadata.put('hosted-usage',{bytes:600000000,objects:1});
  const state=await(await a.get()).json();assert.equal(state.inventorySource,'aggregate');assert.equal(state.inventoryBytesKnown,true);assert.equal(state.units.find(u=>u.kind==='collection').bytes,bytes);
  assert.equal((await a.post('/api/account/retention/keep',{episodeId:state.episode.id,revision:0,keepSelection:['resource:'+resource]})).status,409);
  const saved=await(await a.post('/api/account/retention/keep',{episodeId:state.episode.id,revision:0,keepSelection:['collection:'+inbox.id]})).json();assert.equal(saved.keepSelectionFit,'fits');
 }finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
test('flag off without an episode: the uniform 404 is decided before the request budget (review N4)',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-off-budget-')),now=Date.now();let a;
 try{a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'false'},directory);const statuses=[];for(let n=0;n<35;n++)statuses.push((await a.get()).status);assert.deepEqual([...new Set(statuses)],[404]);}
 finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
test('a billing webhook schedules no alarm of its own when retention has no work (review N5)',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bindle-retention-webhook-')),now=Date.now();let a;
 try{
  a=await account({...base(now),OVER_QUOTA_RETENTION_ENABLED:'true'},directory);const {c,owner}=a,alarms=[];c.billing.applyWebhook=async()=>({accepted:true});const schedule=c.scheduleAlarm.bind(c);c.scheduleAlarm=async time=>{alarms.push(time);return schedule(time);};
  assert.deepEqual(await c.billingWebhookVerified(owner,{owner,id:'evt_n5',type:'subscription.updated',relevant:true,customerId:'customer'}),{accepted:true});assert.deepEqual(alarms,[]);
  await seedLapse(c,owner,now);await c.billingWebhookVerified(owner,{owner,id:'evt_n5b',type:'subscription.updated',relevant:true,customerId:'customer'});assert.deepEqual(alarms,[now+6*3600000]);
 }finally{await a?.app.close();await rm(directory,{recursive:true,force:true});}
});
