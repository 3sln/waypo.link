// Wargame 4 deletion world: one account, its identity directory and recording fake ports for DeletionService
// (docs/architecture/account-deletion-export.md §2, §6). Mirrors the fixture in tests/engine-account-deletion.test.mjs.
import assert from 'node:assert/strict';
import {createTestEngine,OWNER} from './app-engine.mjs';
import {SqliteMetadata} from '../../apps/node/resources.mjs';
import {IdentityRepository} from '../../packages/runtime/accounts.mjs';
import {lifecycleIdentityPort,lifecycleAdminHoldPort,deletionHoldPort,deletionReason} from '../../packages/identity/lifecycle-tombstone.mjs';
import {DeletionService,REQUEST_KEY,FENCE_KEY,deletionDueIndex,sweepDeletionDue,armAlarm,restoreDeletedAccount,emptyAccountCheck,erasureStages,deletionBlocksMaintenance,alarmFenced,deletionGrace,DRAIN_GIVE_UP_MS} from '../../packages/runtime/account-deletion.mjs';
import {purgeBatch,PURGE_KEY,TOMBSTONE_KEY,PURGE_PLANS} from '../../packages/runtime/lifecycle-storage.mjs';
import {RequestAccountDeletion,AccountDeletionStatus,CancelAccountDeletion,CancelAccountDeletionByToken,StepAccountDeletion,ScheduleAdminDeletion,ACCOUNT_DELETION_OPERATIONS} from '../../packages/app/domains/account-deletion.mjs';
import {operations} from '../../packages/app/engine.mjs';
import {key} from '../../packages/core/records.mjs';

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
 const erased={federation:0,mcp:0};
 const erasurePorts=erasure??{
  federation:{async eraseSubject(owner){erased.federation++;events.push('federation.erase');return {deleted:3};}},
  mcp:{async eraseSubject(owner){erased.mcp++;events.push('mcp.erase');return {deleted:2};}},
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
