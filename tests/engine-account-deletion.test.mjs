// DX-3 engine-level tests: account deletion request, cancel, commit, fence, hold and the generalized purge executor
// (docs/architecture/account-deletion-export.md §2, §6, §8.3). Every external effect is a recording fake port.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestEngine,OWNER} from './helpers/app-engine.mjs';
import {SqliteMetadata} from '../apps/node/resources.mjs';
import {IdentityRepository} from '../packages/runtime/accounts.mjs';
import {lifecycleIdentityPort,lifecycleAdminHoldPort,deletionHoldPort,deletionReason} from '../packages/identity/lifecycle-tombstone.mjs';
import {DeletionService,REQUEST_KEY,FENCE_KEY,deletionDueIndex,sweepDeletionDue,armAlarm,restoreDeletedAccount,emptyAccountCheck,erasureStages,deletionBlocksMaintenance,alarmFenced,deletionGrace,DRAIN_GIVE_UP_MS} from '../packages/runtime/account-deletion.mjs';
import {purgeBatch,PURGE_KEY,TOMBSTONE_KEY,PURGE_PLANS} from '../packages/runtime/lifecycle-storage.mjs';
import {RequestAccountDeletion,AccountDeletionStatus,CancelAccountDeletion,CancelAccountDeletionByToken,StepAccountDeletion,ScheduleAdminDeletion,ACCOUNT_DELETION_OPERATIONS} from '../packages/app/domains/account-deletion.mjs';
import {operations} from '../packages/app/engine.mjs';
import {key} from '../packages/core/records.mjs';

const DAY=86400000,HOUR=3600000,FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',HANDLE='delete.me1234',EMAIL='owner@deletion.example';

function memoryBucket(events,label){
 const map=new Map(),bucket={map,failures:0,
  async get(name){const v=map.get(name);if(v===undefined)return null;const bytes=new TextEncoder().encode(v);return {size:bytes.byteLength,text:async()=>v,json:async()=>JSON.parse(v),arrayBuffer:async()=>bytes.buffer};},
  async put(name,value){map.set(name,typeof value==='string'?value:new TextDecoder().decode(value));return {};},
  async delete(names){if(bucket.failures>0){bucket.failures--;throw new Error('bucket unavailable');}for(const name of [names].flat()){if(map.has(name))events?.push(`${label}.delete:${name}`);map.delete(name);}}};
 return bucket;
}
async function digestRows(rows){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows))))].map(b=>b.toString(16).padStart(2,'0')).join('');}

/** One account, its identity directory and fake ports. `options` override ports and flags. */
export async function deletionFixture(t,{seed=1,channels=true,billingFail=null,noticeAccepted=true,erasure,security={epoch:3,changedAt:null},identity:identityOverrides={},budget=64}={}){
 const f=await createTestEngine({seed});
 const events=[],logs=[],notices=[],flags={enabled:true,background:true,global:true};
 const idDb=new SqliteMetadata(':memory:'),dueDb=new SqliteMetadata(':memory:');
 t.after(async()=>{await f.dispose();idDb.close();dueDb.close();});
 const clock=f.clock,repository=new IdentityRepository({metadata:idDb,config:{}});
 assert.equal(await repository.create({id:OWNER,handle:HANDLE,assignmentId:'assignment-1',status:'active',createdAt:clock.now()-DAY,revision:1,verifiedEmail:EMAIL,emailVerifiedAt:clock.now()-DAY,emailLoginEnabled:true,sessions:[{id:'s1'}],credentials:[{id:'c1'}],passwordHash:'hash',recoveryHash:'recovery',audit:[],...identityOverrides}),true);
 await idDb.put(`email/${EMAIL}`,OWNER);
 const identityPort=lifecycleIdentityPort(repository,{clock:clock.now}),identity={get:owner=>identityPort.get(owner),async tombstone(owner,options){events.push('identity.tombstone');return identityPort.tombstone(owner,options);}};
 const blobs=memoryBucket(events,'blobs'),archives=memoryBucket(events,'archives'),metadata=f.metadata;
 let adminHold={held:false},sec={...security},billingFailure=billingFail;
 const billingCalls=[];
 const billing={
  async cancelAtPeriodEnd(owner){billingCalls.push('cancelAtPeriodEnd');if(billingFailure?.cancelAtPeriodEnd)throw Object.assign(new Error('polar down'),{code:'billing_provider_unavailable'});return {set:[{subscriptionId:'sub_1',canceledAt:'2026-10-14T12:00:00Z'}],uncertain:[]};},
  async uncancel(owner,set){billingCalls.push(`uncancel:${set.map(s=>s.subscriptionId).join(',')}`);return {restored:set.map(s=>s.subscriptionId),unrestored:[]};},
  async revokeAll(owner){billingCalls.push('revokeAll');events.push('billing.revokeAll');if(billingFailure?.revokeAll)throw Object.assign(new Error('polar down'),{code:'billing_provider_unavailable'});return {v:1,kind:'revoke',revoked:['sub_1']};},
  async anonymize(owner){billingCalls.push('anonymize');events.push('billing.anonymize');if(billingFailure?.anonymize)throw Object.assign(new Error('polar down'),{code:'billing_provider_unavailable'});return {v:1,kind:'anonymize'};},
 };
 const erased={federation:0,mcp:0,emailBridge:0};
 const erasurePorts=erasure??{
  federation:{async eraseSubject(owner){erased.federation++;events.push('federation.erase');return {deleted:3};}},
  mcp:{async eraseSubject(owner){erased.mcp++;events.push('mcp.erase');return {deleted:2};}},
  emailBridge:{async erase(owner){erased.emailBridge++;events.push('emailBridge.erase');return {deleted:true};}},
  operatorApps:null,
 };
 const ports={
  identity,security:async()=>{if(sec instanceof Error)throw sec;return sec;},hold:async()=>{if(adminHold instanceof Error)throw adminHold;return adminHold;},adminAuthority:async()=>({admin:false}),
  billing,notices:{async deliver(input){notices.push(input);events.push(`notice.${input.kind}`);return {accepted:typeof noticeAccepted==='function'?noticeAccepted(input):noticeAccepted};}},
  erasure:erasurePorts,due:deletionDueIndex(dueDb),
  // A stand-in for DX-1's ExportGeneration.cancelAll: deletes each job's listed keys, its record, pins and the marker.
  exports:{async cancelAll(owner,{budget}){events.push('exports.cancelAll');let deleted=0;for(const [path,job]of await metadata.list({prefix:'export/job/'})){for(const part of job.parts??[]){await archives.delete(part.key);deleted++;}await metadata.delete(path);}for(const path of (await metadata.list({prefix:'export/pin/'})).keys())await metadata.delete(path);await metadata.delete('export/active');return {done:true,deleted};}},
 };
 const executor={metadata,blobs,archives,config:{},async connectionsSeverAccount(owner,{reason}){events.push(`sever:${reason}`);}};
 const flagPort={for:()=>({enabled:()=>flags.enabled,background:()=>flags.background,global:()=>flags.global})};
 const service=new DeletionService({executor,ports,flags:flagPort,clock,random:{uuid:()=>crypto.randomUUID(),bytes:n=>crypto.getRandomValues(new Uint8Array(n))},log:event=>logs.push(event),budget});
 const engine=await createTestEngine({seed,clock,providers:{lifecycle:service}});t.after(()=>engine.dispose());
 // Seed account state: owner binding, a push subscription, owned and foreign blob refs, an export job.
 await metadata.put('owner',OWNER);
 if(channels)await metadata.put(key('push-subscription',OWNER,'p1'),{id:'p1',owner:OWNER,endpoint:'https://push.example/p1',keys:{p256dh:'k',auth:'a'}});
 for(let i=0;i<5;i++){await metadata.put(`hosted-object/res/file${i}`,{key:`file${i}`,version:'v1',blobRef:`objects/${OWNER}/res/v${i}`});await blobs.put(`objects/${OWNER}/res/v${i}`,'data');}
 await metadata.put('foreign-reference',{blobRef:`objects/${FOREIGN}/res/v1`});await blobs.put(`objects/${FOREIGN}/res/v1`,'other');
 await metadata.put('export/job/j1',{v:1,id:'j1',owner:OWNER,state:'ready',parts:[{key:`exports/${OWNER}/j1/account/identity.0000.jsonl`},{key:`exports/${OWNER}/j1/pack.0000`}]});
 for(const part of ['account/identity.0000.jsonl','pack.0000'])await archives.put(`exports/${OWNER}/j1/${part}`,'part');
 await metadata.put('export/active','j1');await metadata.put('export/pin/abc',{jobId:'j1',size:4});
 const owner={kind:'owner',owner:OWNER};
 const fx={f,engine,metadata,blobs,archives,repository,idDb,dueDb,clock,events,logs,notices,billingCalls,erased,ports,service,executor,flags,flagPort,identityPort,
  setHold:value=>{adminHold=value;},setSecurity:value=>{sec=value;},setBillingFailure:value=>{billingFailure=value;},
  request:(input={},actor={})=>engine.perform(new RequestAccountDeletion({actor:{...owner,stepUpAt:clock.now()-1000,...actor},input:{confirmHandle:`@${HANDLE}`,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-0123456789abcdef',...input}})),
  status:()=>engine.read(new AccountDeletionStatus({actor:owner})),
  cancel:(actor=owner)=>engine.perform(new CancelAccountDeletion({actor})),
  cancelToken:token=>engine.perform(new CancelAccountDeletionByToken({actor:{kind:'cancel-link',owner:OWNER},input:{token}})),
  step:()=>engine.perform(new StepAccountDeletion({actor:{kind:'system',owner:OWNER,reason:'test'}})),
  record:()=>metadata.get(REQUEST_KEY),
  async toDeadline(){const r=await metadata.get(REQUEST_KEY);clock.set(r.executeAfter);},
  /** Steps until deleted or `limit` steps, jumping the clock to each wake; returns the step results. */
  async run({limit=400,until='deleted'}={}){const results=[];for(let i=0;i<limit;i++){const out=await fx.step();results.push(out);if(out.action===until||out.action==='deleted')return results;if(Number.isSafeInteger(out.wakeAt)&&out.wakeAt>clock.now())clock.set(out.wakeAt);}return results;},
  async rows(){return [...(await metadata.list({prefix:''})).keys()].filter(k=>k!=='item-index-ready');},
 };
 return fx;
}
const token=input=>input.cancelToken;

test('operations registry: deletion operations declare their lifecycle levels and terms exemption',()=>{
 const registry=operations(...ACCOUNT_DELETION_OPERATIONS);
 assert.deepEqual(Object.fromEntries(Object.entries(registry).map(([name,op])=>[name,op.lifecycle])),{'deletion.request':'suspended','deletion.status':'suspended','deletion.cancel':'purging','deletion.cancel-token':'purging','deletion.step':'purging','deletion.schedule-admin':'suspended'});
 for(const op of ACCOUNT_DELETION_OPERATIONS)assert.equal(op.termsGate,'exempt');
});

test('request: flag, step-up, typed handle, acknowledgements, idempotent operation IDs and refusals',async t=>{
 const x=await deletionFixture(t);
 x.flags.enabled=false;await assert.rejects(x.request(),{code:'not_found'});x.flags.enabled=true;
 await assert.rejects(x.request({},{stepUpAt:undefined}),{code:'step_up_required'});
 await assert.rejects(x.request({},{stepUpAt:x.clock.now()-300000}),{code:'step_up_required'});
 await assert.rejects(x.request({},{stepUpAt:x.clock.now()+1000}),{code:'step_up_required'});
 await assert.rejects(x.request({confirmHandle:'delete.me'}),{code:'confirmation_mismatch'});
 await assert.rejects(x.request({acknowledgements:{messages:true,storage:true,names:true}}),{code:'acknowledgement_required'});// paid unknown: the plan statement is required
 await assert.rejects(x.request({operationId:'short'}),{code:'invalid_request'});
 await assert.rejects(x.request({extra:true}),{code:'invalid_request'});
 const first=await x.request();
 assert.equal(first.state,'scheduled');assert.equal(first.graceDays,14);assert.equal(first.executeAfter,x.clock.now()+14*DAY);assert.equal(first.cancellable,true);
 assert.deepEqual(await x.request(),first,'replay returns the stored result');
 await assert.rejects(x.request({confirmHandle:HANDLE}),{code:'operation_conflict'});
 await assert.rejects(x.request({operationId:'op-fedcba9876543210'}),{code:'deletion_scheduled'});
 const record=await x.record();
 assert.deepEqual(record.channels,{email:EMAIL,emailVerifiedAt:record.channels.emailVerifiedAt,push:[{id:'p1',endpoint:'https://push.example/p1',keys:{p256dh:'k',auth:'a'}}]});
 assert.deepEqual(record.billing.set,[{subscriptionId:'sub_1',canceledAt:'2026-10-14T12:00:00Z'}]);assert.equal(record.billing.pending,false);
 assert.equal(x.notices.length,1);assert.equal(x.notices[0].kind,'scheduled');assert.match(token(x.notices[0]),/^[A-Za-z0-9_-]{43}$/);assert.equal(record.noticeAccepted,true);
 assert.equal(JSON.stringify(record).includes(token(x.notices[0])),false,'only the token hash is stored');
 assert.equal((await x.ports.due.due({now:record.executeAfter})).length,1);
 assert.equal(JSON.stringify(await x.status()).includes(EMAIL),false,'status never exposes channels');
});

test('request refusals: recovering, suspended, admin role, internal identity, unreadable security state',async t=>{
 for(const [overrides,code] of [[{status:'recovering'},'recovery_pending'],[{status:'suspended'},'account_suspended']]){
  const x=await deletionFixture(t,{identity:overrides});await assert.rejects(x.request(),{code});
 }
 const internal=await deletionFixture(t);const get=internal.ports.identity.get;internal.ports.identity.get=async owner=>({...await get(owner),systemIdentity:true});await assert.rejects(internal.request(),{code:'admin_role_held'});
 const admin=await deletionFixture(t);admin.ports.adminAuthority=async()=>({admin:true});await assert.rejects(admin.request(),{code:'admin_role_held'});
 const broken=await deletionFixture(t);broken.setSecurity(new Error('down'));await assert.rejects(broken.request(),{code:'deletion_unavailable'});
 const unconfigured=await deletionFixture(t);delete unconfigured.ports.security;await assert.rejects(unconfigured.request(),{code:'deletion_unavailable'});
});

test('grace: 30 days after a security change in the previous 72 hours, read from the security state',async t=>{
 const now=Date.UTC(2026,9,14,12);
 assert.equal(deletionGrace({now,security:{epoch:1,changedAt:now-71*HOUR}}).graceDays,30);
 assert.equal(deletionGrace({now,security:{epoch:1,changedAt:now-73*HOUR}}).graceDays,14);
 assert.equal(deletionGrace({now,security:{epoch:1,changedAt:now+HOUR}}).graceDays,30,'a future change counts as recent');
 const x=await deletionFixture(t,{security:{epoch:9,changedAt:Date.UTC(2026,9,14,12)-2*HOUR}});
 const result=await x.request();assert.equal(result.graceDays,30);assert.equal(result.executeAfter,x.clock.now()+30*DAY);
});

test('cancel: owner cancel undoes only our cancel-at-period-end, removes the due row; cancel link works once; after commit 410',async t=>{
 const x=await deletionFixture(t);await x.request();
 const cancelled=await x.cancel();assert.equal(cancelled.state,'cancelled');assert.deepEqual(x.billingCalls,['cancelAtPeriodEnd','uncancel:sub_1']);
 assert.equal((await x.ports.due.due({now:Infinity})).length,0);assert.equal((await x.record()).channels,null,'channel copies are dropped');
 assert.equal((await x.cancel()).state,'cancelled','idempotent');
 // A new request after cancel is allowed; the cancel link from its notice cancels it.
 x.clock.advance(HOUR);await x.request({operationId:'op-second-0123456789'});const link=token(x.notices.at(-1));
 await assert.rejects(x.cancelToken('A'.repeat(43)),{code:'invalid_token'});
 assert.equal((await x.cancelToken(link)).state,'cancelled');
 await assert.rejects(x.cancelToken(link),{code:'invalid_token'});
 // After the deadline commit, cancel answers deletion_in_progress.
 x.clock.advance(HOUR);await x.request({operationId:'op-third-01234567890'});const late=token(x.notices.at(-1));await x.toDeadline();
 assert.equal((await x.step()).action,'committed');
 await assert.rejects(x.cancel(),{code:'deletion_in_progress',status:410});
 await assert.rejects(x.cancelToken(late),{code:'invalid_token'});
 assert.equal(await x.metadata.get(FENCE_KEY)!==undefined,true);
});

test('commit holds without an accepted notice or under an admin hold; push copies survive row deletion',async t=>{
 const x=await deletionFixture(t,{noticeAccepted:false});await x.request();
 // Deleting push-subscription rows after the request does not stop push notices: the snapshot holds copies.
 await x.metadata.delete(key('push-subscription',OWNER,'p1'));
 await x.toDeadline();const held=await x.step();assert.equal(held.action,'hold');assert.equal(held.reason,'notice-unaccepted');
 assert.equal(x.notices.at(-1).channels.push[0].endpoint,'https://push.example/p1');
 assert.equal(await x.metadata.get(FENCE_KEY),undefined);
 const y=await deletionFixture(t);await y.request();y.setHold({held:true});await y.toDeadline();
 assert.equal((await y.step()).reason,'admin-hold');y.setHold(new Error('admin store down'));y.clock.advance(HOUR);assert.equal((await y.step()).reason,'admin-hold');
 y.setHold({held:false});y.clock.advance(2*HOUR);assert.equal((await y.step()).action,'committed');
 // An owner whose snapshot has no channel proceeds without the acceptance requirement.
 const z=await deletionFixture(t,{channels:false,identity:{verifiedEmail:null,emailVerifiedAt:null}});await z.request();await z.toDeadline();assert.equal((await z.step()).action,'committed');
});

test('execution order: billing stop, identity, grants, drain, email bridge, exports, blobs, anonymize, notice, wipe',async t=>{
 const x=await deletionFixture(t);await x.request();await x.toDeadline();
 const results=await x.run();assert.equal(results.at(-1).action,'deleted',JSON.stringify(results.slice(-3)));
 const order=x.events.filter(e=>!e.startsWith('blobs.')&&!e.startsWith('archives.')&&e!=='notice.scheduled');
 assert.deepEqual(order,['notice.reminder-3d','notice.reminder-1d','notice.executing','billing.revokeAll','sever:deleted','identity.tombstone','federation.erase','mcp.erase','emailBridge.erase','exports.cancelAll','billing.anonymize','notice.completed'].filter(e=>order.includes(e)));
 const at=name=>x.events.findIndex(e=>e.startsWith(name));
 assert(at('billing.revokeAll')<at('identity.tombstone')&&at('identity.tombstone')<at('federation.erase')&&at('emailBridge.erase')<at('archives.delete:exports/')&&at('archives.delete:exports/')<at(`blobs.delete:objects/${OWNER}`)&&at(`blobs.delete:objects/${OWNER}`)<at('billing.anonymize')&&at('billing.anonymize')<at('notice.completed'));
 assert.deepEqual(await x.rows(),['lifecycle/tombstone-v1','owner']);
 const tombstone=await x.metadata.get(TOMBSTONE_KEY);assert.equal(tombstone.reason,'owner');assert.equal(tombstone.basis,'owner');assert.equal(tombstone.deletedBlobs,5);assert.equal(tombstone.foreignReferences,1);
 for(let i=0;i<5;i++)assert.equal(x.blobs.map.has(`objects/${OWNER}/res/v${i}`),false);
 assert.equal(x.blobs.map.has(`objects/${FOREIGN}/res/v1`),true,'foreign refs are untouched');
 assert.equal([...x.archives.map.keys()].some(k=>k.startsWith('exports/')),false,'no export part survives');
 const account=await x.repository.get(OWNER);assert.equal(account.status,'deleted');assert.equal(account.handle,HANDLE);assert.equal(account.assignmentId,'assignment-1');assert.deepEqual(account.sessions,[]);assert.equal(account.passwordHash,null);
 assert.equal(deletionReason(account),'owner');assert.equal(account.security,undefined);
 assert.equal(await x.repository.findByEmail(EMAIL),null,'the email address is released');
 assert.equal((await x.ports.due.due({now:Infinity})).length,0);
 assert.equal(x.notices.find(n=>n.kind==='completed').channels.push.length,0,'completion notice is email only');
 assert.deepEqual(x.erased,{federation:1,mcp:1,emailBridge:1});
 assert.equal((await x.step()).action,'deleted');
 assert(x.logs.every(e=>!JSON.stringify(e).includes(EMAIL)&&!JSON.stringify(e).includes('push.example')));
});

test('Polar outage at E1 holds with backoff and never reaches E2; an outage at E9 holds before the wipe',async t=>{
 const x=await deletionFixture(t);await x.request();await x.toDeadline();await x.step();
 x.setBillingFailure({revokeAll:true});
 const held=await x.step();assert.equal(held.action,'hold');assert.equal(held.reason,'billing-billing_provider_unavailable');assert.equal(held.wakeAt,x.clock.now()+HOUR);
 x.clock.advance(HOUR);assert.equal((await x.step()).wakeAt,x.clock.now()+2*HOUR,'backoff doubles');
 assert.equal((await x.repository.get(OWNER)).status,'active');assert.equal(x.events.includes('identity.tombstone'),false);
 x.setBillingFailure(null);const y=await deletionFixture(t);await y.request();await y.toDeadline();y.setBillingFailure({anonymize:true});
 const results=await y.run({limit:60,until:'hold'});const last=results.at(-1);assert.equal(last.action,'hold');assert.equal(last.reason,'billing-billing_provider_unavailable');
 assert.equal((await y.metadata.get(PURGE_KEY)).stage,'billing-anonymize');assert.equal(await y.metadata.get(TOMBSTONE_KEY),undefined);
 y.setBillingFailure(null);assert.equal((await y.run()).at(-1).action,'deleted');
 const finished=await x.run();assert.equal(finished.at(-1).action,'deleted');
});

test('admin hold mid-execution halts before the next destructive stage; release resumes',async t=>{
 const x=await deletionFixture(t,{budget:2});
 for(let i=0;i<70;i++){await x.metadata.put(`hosted-object/bulk/f${String(i).padStart(3,'0')}`,{blobRef:`objects/${OWNER}/bulk/v${i}`});await x.blobs.put(`objects/${OWNER}/bulk/v${i}`,'x');}
 await x.request();await x.toDeadline();await x.step();
 await x.step();// billing-stop .. into blobs with a tiny budget
 const stage=(await x.metadata.get(PURGE_KEY)).stage;x.setHold({held:true});
 const before=x.blobs.map.size;const held=await x.step();assert.equal(held.reason,'admin-hold');assert.equal(x.blobs.map.size,before);assert.equal((await x.metadata.get(PURGE_KEY)).stage,stage);
 x.setHold({held:false});assert.equal((await x.run()).at(-1).action,'deleted');
});

test('E5 holds when vector rows exist but the index is unavailable; unconfigured erasure ports hold, null ports skip',async t=>{
 const x=await deletionFixture(t);await x.metadata.put(key('search-vector-revision',OWNER,'m1'),{id:'m1'});await x.request();await x.toDeadline();
 const held=(await x.run({limit:40,until:'hold'})).at(-1);assert.equal(held.reason,'vector-index-unavailable');assert.equal((await x.metadata.get(PURGE_KEY)).stage,'vectors');
 assert.equal(x.blobs.map.has(`objects/${OWNER}/res/v0`),true,'nothing past E5 ran');
 const y=await deletionFixture(t,{erasure:{mcp:null,emailBridge:null,operatorApps:null}});await y.request();await y.toDeadline();
 assert.equal((await y.run({limit:40,until:'hold'})).at(-1).reason,'erasure-port-unconfigured:federation');
 y.ports.erasure.federation=null;assert.equal((await y.run()).at(-1).action,'deleted');
 const job=await y.metadata.get(PURGE_KEY);assert.equal(job,undefined);
});

test('E6 without an export port holds; a null port (no export store on this host) is a recorded no-op',async t=>{
 const x=await deletionFixture(t);delete x.ports.exports;await x.request();await x.toDeadline();
 assert.equal((await x.run({limit:40,until:'hold'})).at(-1).reason,'erasure-port-unconfigured:exports');
 assert.equal(x.archives.map.has(`exports/${OWNER}/j1/pack.0000`),true,'no parts-only fallback runs');
 let calls=0;x.ports.exports={async cancelAll(owner,{budget}){calls++;return calls<2?{done:false,wakeAt:x.clock.now()+2000}:{done:true};}};
 assert.equal((await x.run()).at(-1).action,'deleted');assert.equal(calls,2,'DX-1 wakeAt continuation is honoured');
});

test('R1-M12 operator apps: the pluggable port is awaited until it acknowledges; unwired (undefined) holds',async t=>{
 let acks=0;const calls=[];
 const x=await deletionFixture(t,{erasure:{federation:null,mcp:null,emailBridge:null,operatorApps:{async ownerDeleted(owner,input){calls.push(input);return ++acks<3?{done:false}:{done:true};}}}});
 await x.request();await x.toDeadline();assert.equal((await x.run()).at(-1).action,'deleted');assert.equal(calls.length,3);assert.deepEqual(calls[0],{reason:'owner',basis:'owner'});
 const y=await deletionFixture(t,{erasure:{federation:null,mcp:null,emailBridge:null}});await y.request();await y.toDeadline();
 assert.equal((await y.run({limit:40,until:'hold'})).at(-1).reason,'erasure-port-unconfigured:operatorApps');
});

test('E4 drain: outbox rows are drained, or dropped after 72 hours with a count',async t=>{
 const x=await deletionFixture(t);await x.metadata.put('connections/cascade/1',{k:1});let drains=0;
 x.executor.connectionsDrain=async owner=>{drains++;if(drains>=3)await x.metadata.delete('connections/cascade/1');return {drained:drains>=3?1:0};};
 await x.request();await x.toDeadline();assert.equal((await x.run()).at(-1).action,'deleted');assert.equal(drains,3);
 const y=await deletionFixture(t);await y.metadata.put('integration-events/row/1',{k:1});await y.request();await y.toDeadline();
 const start=y.clock.now();assert.equal((await y.run({limit:400})).at(-1).action,'deleted');
 assert(y.clock.now()-start>=DRAIN_GIVE_UP_MS);assert(y.logs.some(e=>e.action==='drain-dropped'&&e.dropped===1));
});

test('security change during grace moves the deadline to at least 14 days later and needs a new accepted notice',async t=>{
 const x=await deletionFixture(t);const first=await x.request();
 x.clock.advance(10*DAY);const recoveredAt=x.clock.now();x.setSecurity({epoch:4,changedAt:recoveredAt});
 await x.step();const record=await x.record();assert.equal(record.executeAfter,recoveredAt+14*DAY);assert(record.executeAfter>first.executeAfter);
 assert.equal(x.notices.at(-1).kind,'scheduled');assert.equal(record.noticeAccepted,true);
 x.clock.set(first.executeAfter);assert.equal((await x.step()).action,'wait');
 x.clock.set(record.executeAfter);assert.equal((await x.step()).action,'committed');
 const broken=await deletionFixture(t);await broken.request();await broken.toDeadline();broken.setSecurity(new Error('down'));
 assert.equal((await broken.step()).reason,'security-unavailable');assert.equal(await broken.metadata.get(FENCE_KEY),undefined);
});

test('env kill: background steps halt and cancel refuses; a committed request stays fenced',async t=>{
 const x=await deletionFixture(t);await x.request();x.flags.background=false;
 await assert.rejects(x.cancel(),{code:'deletion_unavailable'});await x.toDeadline();assert.equal((await x.step()).action,'killed');assert.equal(await x.metadata.get(FENCE_KEY),undefined);
 x.flags.background=true;await x.step();x.flags.background=false;assert.equal((await x.step()).action,'killed');assert.notEqual(await x.metadata.get(FENCE_KEY),undefined);
 x.flags.background=true;x.flags.enabled=false;assert.equal((await x.run()).at(-1).action,'deleted','the request flag gates new requests only');
});

test('admin closure: a suspended closed account executes at exportUntil; a legal hold placed later pauses it; admin-email rules',async t=>{
 const x=await deletionFixture(t);const exportUntil=x.clock.now()+30*DAY;
 const repoAccount=await x.repository.get(OWNER);await x.repository.compareAndSwap(OWNER,repoAccount.revision,{...repoAccount,status:'suspended',revision:repoAccount.revision+1});
 const hold=deletionHoldPort({store:null,repository:x.repository});assert.deepEqual(await hold(OWNER),{held:false,since:null,releasedAt:null});
 assert.equal((await lifecycleAdminHoldPort({store:null,repository:x.repository})(OWNER)).held,true,'the lifecycle port would freeze it (R1-M8)');
 x.ports.hold=hold;
 const scheduled=await x.engine.perform(new ScheduleAdminDeletion({actor:{kind:'system',owner:OWNER,reason:'admin'},input:{basis:'admin-closure',operationId:'op-closure-0123456789',adminAuditSeq:7,exportUntil}}));
 assert.equal(scheduled.executeAfter,exportUntil);assert.equal(scheduled.cancellable,false);
 await assert.rejects(x.cancel(),{code:'deletion_not_cancellable'});assert.equal(token(x.notices[0]),undefined,'no cancel link for admin bases');
 x.clock.set(exportUntil);assert.equal((await x.step()).action,'committed');
 x.ports.hold=async()=>({held:true});assert.equal((await x.step()).reason,'admin-hold');
 x.ports.hold=hold;assert.equal((await x.run()).at(-1).action,'deleted');assert.equal((await x.metadata.get(TOMBSTONE_KEY)).basis,'admin-closure');
 assert.equal(deletionReason(await x.repository.get(OWNER)),'admin-closure');
 const y=await deletionFixture(t,{identity:{emailLoginEnabled:false}});
 await assert.rejects(y.engine.perform(new ScheduleAdminDeletion({actor:{kind:'system',owner:OWNER,reason:'admin'},input:{basis:'admin-email',operationId:'op-email-01234567890',adminAuditSeq:8}})),{code:'email_login_disabled'});
 const z=await deletionFixture(t);const email=await z.engine.perform(new ScheduleAdminDeletion({actor:{kind:'system',owner:OWNER,reason:'admin'},input:{basis:'admin-email',operationId:'op-email-01234567890',adminAuditSeq:8}}));
 assert.equal(email.graceDays,30);assert.equal(email.cancellable,true);
 const reversed=await z.engine.perform(new CancelAccountDeletion({actor:{kind:'system',owner:OWNER,reason:'closure-reversed'}}));assert.equal(reversed.state,'cancelled');
});

test('restore path: an empty object for a deleted identity rebuilds the tombstone in lifecycle mode off; live identities pass once',async t=>{
 const x=await deletionFixture(t);await x.identityPort.tombstone(OWNER,{assignmentId:'assignment-1',reason:'owner'});
 const empty=new SqliteMetadata(':memory:');t.after(()=>empty.close());const c={metadata:empty,config:{}};
 const fault=await emptyAccountCheck(c,OWNER,x.identityPort);assert.equal(fault.code,'account_deleted');assert.equal(fault.status,410);
 assert.deepEqual([...(await empty.list({prefix:''})).keys()],['lifecycle/tombstone-v1','owner']);
 const tombstone=await empty.get(TOMBSTONE_KEY);assert.equal(tombstone.reason,'owner');assert.equal(tombstone.basis,'owner');assert.equal(tombstone.restored,true);
 assert.deepEqual(await restoreDeletedAccount(c,OWNER,x.identityPort),{deleted:true,restored:false});
 const y=await deletionFixture(t);const fresh=new SqliteMetadata(':memory:');t.after(()=>fresh.close());let reads=0;
 const counted={get:async owner=>{reads++;return y.identityPort.get(owner);}},d={metadata:fresh,config:{}};
 assert.equal(await emptyAccountCheck(d,OWNER,counted),null);assert.equal(await emptyAccountCheck(d,OWNER,counted),null);assert.equal(reads,1,'one identity read per object lifetime');
 const down={metadata:new SqliteMetadata(':memory:'),config:{}};t.after(()=>down.metadata.close());
 assert.equal((await emptyAccountCheck(down,OWNER,{get:async()=>{throw new Error('down');}})).code,'lifecycle_unavailable');
 // The inactive reason maps to the existing value.
 const z=await deletionFixture(t);await z.identityPort.tombstone(OWNER,{assignmentId:'assignment-1'});const e=new SqliteMetadata(':memory:');t.after(()=>e.close());
 await restoreDeletedAccount({metadata:e},OWNER,z.identityPort);assert.equal((await e.get(TOMBSTONE_KEY)).reason,'inactive-unpaid');
});

test('inactivity purge on the same executor: common erasure stages remove exports, grants and bridge state (R1-H3/H4)',async t=>{
 const x=await deletionFixture(t);let fenceCalls=0;const fence=async()=>{fenceCalls++;return true;};
 const stages=erasureStages(x.executor,{ports:x.ports,clock:x.clock.now});
 for(let i=0;i<20;i++){const out=await purgeBatch(x.executor,OWNER,{identity:x.ports.identity,fence,budget:64,stages,clock:x.clock.now});if(out.done)break;assert.equal(out.halted,undefined,JSON.stringify(out));if(out.wakeAt)x.clock.set(out.wakeAt);}
 assert.deepEqual(await x.rows(),['lifecycle/tombstone-v1','owner']);assert.equal((await x.metadata.get(TOMBSTONE_KEY)).reason,'inactive-unpaid');
 assert.equal([...x.archives.map.keys()].some(k=>k.startsWith('exports/')),false);assert.deepEqual(x.erased,{federation:1,mcp:1,emailBridge:1});
 assert.equal(deletionReason(await x.repository.get(OWNER)),'inactive');assert.equal(x.events.includes('billing.revokeAll'),false);
 assert(fenceCalls>=PURGE_PLANS.lifecycle.length,'a fresh fence before every stage');
 // The pre-DX-3 call shape (no hooks) keeps the legacy plan and the new E5 hold.
 const y=await deletionFixture(t);await y.metadata.put(key('search-vector-revision',OWNER,'m1'),{id:'m1'});
 const legacy=await purgeBatch(y.executor,OWNER,{identity:y.ports.identity,fence:async()=>true});assert.equal(legacy.hold,'vector-index-unavailable');assert.deepEqual((await y.metadata.get(PURGE_KEY)).plan,PURGE_PLANS.legacy);
 // A later call with hooks upgrades it and re-runs from grants.
 await y.metadata.delete(key('search-vector-revision',OWNER,'m1'));
 for(let i=0;i<20;i++){const out=await purgeBatch(y.executor,OWNER,{identity:y.ports.identity,fence:async()=>true,stages:erasureStages(y.executor,{ports:y.ports,clock:y.clock.now}),clock:y.clock.now});if(out.done)break;if(out.wakeAt)y.clock.set(out.wakeAt);}
 assert.deepEqual(y.erased,{federation:1,mcp:1,emailBridge:1});assert.equal([...y.archives.map.keys()].some(k=>k.startsWith('exports/')),false);
 await assert.rejects(purgeBatch(y.executor,OWNER,{identity:y.ports.identity,fence:async()=>true,reason:'owner'}),TypeError);
});

test('E8 re-check: rows shelved between E7 and E8 send the job back to E7 and no owned blob survives (R1-H2)',async t=>{
 const x=await deletionFixture(t,{budget:2});let shelved=false;
 // More than one 32-row page of owned refs, so E8 spans several batches.
 for(let i=0;i<70;i++){await x.metadata.put(`hosted-object/bulk/f${String(i).padStart(3,'0')}`,{blobRef:`objects/${OWNER}/bulk/v${i}`});await x.blobs.put(`objects/${OWNER}/bulk/v${i}`,'x');}
 await x.request();await x.toDeadline();
 // Commit, then run until the job reaches blobs; then shelve a message row with its own blob before E8 finishes.
 await x.step();
 for(let i=0;i<30;i++){const job=await x.metadata.get(PURGE_KEY);if(job?.stage==='blobs')break;const out=await x.step();if(out.wakeAt>x.clock.now())x.clock.set(out.wakeAt);}
 assert.equal((await x.metadata.get(PURGE_KEY)).stage,'blobs');
 const rows=[[`message/${OWNER}/m1`,{owner:OWNER,id:'m1',blobRef:`messages/${OWNER}/m1`}]];await x.blobs.put(`messages/${OWNER}/m1`,'body');
 await x.archives.put(`accounts/${OWNER}.json`,JSON.stringify({version:1,owner:OWNER,rows,digest:await digestRows(rows)}));await x.metadata.put('shelved',true);shelved=true;
 const result=await x.run();assert.equal(result.at(-1).action,'deleted');assert(shelved);
 assert.equal(x.blobs.map.has(`messages/${OWNER}/m1`),false);assert.equal(x.archives.map.has(`accounts/${OWNER}.json`),false);assert.equal([...x.blobs.map.keys()].filter(k=>k.startsWith(`objects/${OWNER}/`)).length,0);
 assert(x.logs.some(e=>e.action==='purge-archive-recheck'));
});

test('wake invariant and sweep: min-merge never moves the alarm later; the sweep ticks due requests without an alarm',async t=>{
 const store=new SqliteMetadata(':memory:');t.after(()=>store.close());const now=Date.now();
 await armAlarm(store,now+DAY,now);assert.equal(await store.getAlarm(),now+DAY);
 await armAlarm(store,now+7*DAY,now);assert.equal(await store.getAlarm(),now+DAY,'a maintenance retry never moves the alarm past executeAfter');
 await armAlarm(store,now+HOUR,now);assert.equal(await store.getAlarm(),now+HOUR);
 const x=await deletionFixture(t);await x.request();await x.toDeadline();
 const invoked=[];const accounts={get:id=>({invoke:async envelope=>{invoked.push(envelope);return x.step();}})};
 const swept=await sweepDeletionDue({index:x.ports.due,accounts,now:x.clock.now()});assert.deepEqual(swept,{ticked:1,failed:0});
 assert.deepEqual(invoked[0],{method:'deletionTick',args:[OWNER,{source:'sweep'}]});assert.notEqual(await x.metadata.get(FENCE_KEY),undefined);
 assert.equal((await sweepDeletionDue({index:x.ports.due,accounts,now:x.clock.now()-1})).ticked,0);
});

test('alarm isolation predicates: shelving and backfill refuse while scheduled; the alarm stops while fenced or purging',async t=>{
 const x=await deletionFixture(t);assert.equal(await deletionBlocksMaintenance(x.metadata),false);assert.equal(await alarmFenced(x.metadata),false);
 await x.request();assert.equal(await deletionBlocksMaintenance(x.metadata),true);assert.equal(await alarmFenced(x.metadata),false);
 await x.toDeadline();await x.step();assert.equal(await alarmFenced(x.metadata),true);
 await x.run();assert.equal(await alarmFenced(x.metadata),true);
 const y=await deletionFixture(t);await y.request();await y.cancel();assert.equal(await deletionBlocksMaintenance(y.metadata),false);
});

test('identity port: tombstone reasons are validated and the deletion hold ignores suspension',async t=>{
 const x=await deletionFixture(t);await assert.rejects(x.identityPort.tombstone(OWNER,{reason:'other'}),TypeError);
 const view=await x.identityPort.get(OWNER);assert.equal(view.handle,HANDLE);assert.equal(view.emailLoginEnabled,true);assert.equal(view.systemIdentity,false);
 const status=await x.status();assert.equal(status.state,'none');
});

test('account slice: composes over a real AccountController; the alarm hook steps first and reports the fence',async t=>{
 const {AccountController}=await import('../packages/runtime/accounts.mjs');
 const {SerialGate}=await import('../apps/node/resources.mjs');
 class DeletionController extends AccountController{}// the deletion slice is registered (packages/runtime/account/index.mjs)
 const x=await deletionFixture(t);let now=x.clock.now();
 const db=new SqliteMetadata(':memory:');t.after(()=>db.close());
 // Real flag evaluation (registry row from DX-1): default off for new requests, background on unless env-killed.
 const config={APP_ORIGIN:'https://deletion.example',LIFECYCLE_CLOCK:()=>now,LIFECYCLE_LOG:()=>{},ACCOUNT_DELETION_PORTS:x.ports};
 const controller=new DeletionController({metadata:db,gate:new SerialGate(),blobs:x.blobs,archives:x.archives,config,sql:db.sql});
 await controller.warm(OWNER);
 await assert.rejects(controller.deletionRequest(OWNER,{confirmHandle:HANDLE,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-slice-0123456789'},{stepUpAt:now-1000}),{code:'not_found'});
 config.ACCOUNT_DELETION_ENABLED='true';
 await assert.rejects(controller.deletionRequest(OWNER,{confirmHandle:HANDLE,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-slice-0123456789'},{}),{code:'step_up_required'});
 const scheduled=await controller.deletionRequest(OWNER,{confirmHandle:HANDLE,acknowledgements:{messages:true,storage:true,names:true,plan:true},operationId:'op-slice-0123456789'},{stepUpAt:now-1000});
 assert.equal(scheduled.state,'scheduled');assert.equal((await controller.deletionStatus(OWNER)).state,'scheduled');
 assert.equal(await controller.deletionMaintenanceRefused(),true);
 assert.deepEqual(await controller.deletionAlarm(),{stop:false,wakeAt:now+DAY,action:'wait'},'grace re-checks the security state at least daily');
 now=scheduled.executeAfter;
 // The request flag gates new requests only: turned off (not killed), execution still proceeds.
 delete config.ACCOUNT_DELETION_ENABLED;
 const first=await controller.deletionAlarm();assert.equal(first.action,'committed');assert.equal(first.stop,true,'the alarm returns right after the deletion tick once fenced');
 const seen=[];for(let i=0;i<50;i++){const out=await controller.deletionAlarm();seen.push(out.action+':'+((await db.get(PURGE_KEY))?.stage??'')+':'+((await db.get(REQUEST_KEY))?.hold?.reason??''));if(out.action==='deleted')break;if(out.wakeAt>now)now=out.wakeAt;}assert.equal(seen.at(-1).split(':')[0],'deleted',seen.join(' '));
 assert.deepEqual([...(await db.list({prefix:''})).keys()].filter(k=>!['@alarm','item-index-ready'].includes(k)).sort(),['lifecycle/tombstone-v1','owner']);
 assert.equal((await controller.deletionAlarm()).stop,true);assert.equal((await x.repository.get(OWNER)).status,'deleted');
 assert.equal((await controller.deletionTick(OWNER)).action,'deleted');
});

test('billing races: a cancel that commits while cancel-at-period-end is in flight still undoes it; a running inactivity purge holds the commit',async t=>{
 const x=await deletionFixture(t,{billingFail:{cancelAtPeriodEnd:true}});await x.request();
 assert.equal((await x.record()).billing.pending,true,'the request commits even when Polar fails');
 x.setBillingFailure(null);let release;const gate=new Promise(resolve=>{release=resolve;});
 const original=x.ports.billing.cancelAtPeriodEnd;x.ports.billing.cancelAtPeriodEnd=async owner=>{const out=await original(owner);await gate;return out;};
 x.clock.advance(2*3600000);const stepping=x.step();
 await new Promise(resolve=>setTimeout(resolve,20));const cancelled=await x.cancel();assert.equal(cancelled.state,'cancelled');
 release();await stepping;
 // The cancel's own undo runs on the DX-4 journal (empty set); the late result is undone again with its set.
 assert.deepEqual(x.billingCalls,['cancelAtPeriodEnd','cancelAtPeriodEnd','uncancel:','uncancel:sub_1']);assert.equal((await x.record()).billing.uncancelPending,false);
 const y=await deletionFixture(t);await y.request();await y.metadata.put(PURGE_KEY,{version:1,owner:OWNER,reason:'inactive',plan:PURGE_PLANS.lifecycle,stage:'identity'});await y.toDeadline();
 assert.equal((await y.step()).reason,'inactivity-purge-running');assert.equal(await y.metadata.get(FENCE_KEY),undefined);
});
