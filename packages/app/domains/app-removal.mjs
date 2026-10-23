// AU-S2. A pending removal is bookkeeping, never a credential fence (UD-1). Every transition is serialized by
// accountStore.transaction; completion and force use the same co-transactional revocation port (AU-S3).
import {Provider} from '../../../vendor/ngin/index.js';
import {AppAction,AppQuery} from '../engine.mjs';
import {AppFault} from '../faults.mjs';
import {parseRemovalResult} from '../../federation/removal.mjs';
export const REMOVAL_RECORD='app-removal/record/',REMOVAL_OPEN='app-removal/open/',REMOVAL_NOTICE='app-removal/notice/';
export const removalOpen=r=>['pending','in-progress'].includes(r?.state);
const fail=(code,message,status=409)=>{throw new AppFault(code,message,status);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const input=(v,names)=>{if(!plain(v)||Object.keys(v).some(k=>!names.includes(k)))fail('invalid_request','Unsupported removal request.',400);return v;};
const index=client=>REMOVAL_OPEN+encodeURIComponent(client),key=id=>REMOVAL_RECORD+id;
const view=r=>{if(!r)return null;const {binding,reissues,...visible}=r;return structuredClone(visible);};
const hash=async value=>{if(typeof value!=='string'||value.length<32||value.length>256)return null;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');};
const result=v=>{if(v===undefined)return undefined;try{const raw=new TextEncoder().encode(JSON.stringify(v));let s='';for(const b of raw)s+=String.fromCharCode(b);return parseRemovalResult(btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''));}catch{return undefined;}};
/** AU-13 policy hook. Organizations remain refused until membership/admin authorization exists. */
export function removalPolicy({kind='person',now,admins=[]}={}){return kind==='organization'?{supported:false,delay:86400000,notBefore:now+86400000,notify:[...new Set(admins)],forceDelay:0}:{supported:kind==='person',delay:0,notBefore:now,notify:[],forceDelay:0};}
export class AppRemovalService{
 constructor({metadata,clock={now:()=>Date.now()},random={uuid:()=>crypto.randomUUID()},enabled=()=>false,resume,commit,wake=()=>{}}){Object.assign(this,{metadata,clock,random,enabled,resume,commit,wake});}
 async bound(tx,actor,system=false){if(!actor||!(system?['owner','system','app']:['owner']).includes(actor.kind)||!/^[a-f0-9-]{36}$/.test(actor.owner??''))fail('unauthorized','Sign in to continue.',401);if(await tx.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);return actor.owner;}
 async connection(tx,owner,id){const r=typeof id==='string'?await tx.get('resource/'+id):null;if(r?.kind!=='app-connection'||r.owner!==owner)fail('not_found','Not found.',404);return r;}
 async list(actor){return this.metadata.transaction(async tx=>{const owner=await this.bound(tx,actor);return {removals:[...(await tx.list({prefix:REMOVAL_RECORD})).values()].filter(r=>r.entity===owner).map(view)};});}
 async start(actor,value){const v=input(value,['connection','expectedGeneration','binding']),binding=await hash(v.binding);if(!binding)fail('invalid_request','A browser binding is required.',400);
 const row=await this.metadata.transaction(async tx=>{const owner=await this.bound(tx,actor),now=this.clock.now(),entity=await tx.get('identity/entity');if(!removalPolicy({kind:entity?.kind??'person',now}).supported)fail('unsupported_entity','Organization removal is not available.',409);
 if(await tx.get('deletion/fence-v1')||await tx.get('lifecycle/tombstone-v1')||['suspended','purge-review','purging'].includes((await tx.get('lifecycle/state-v1'))?.phase))fail('account_unavailable','This account is unavailable.',409);
 let c=await this.connection(tx,owner,v.connection);if(!this.enabled(owner,c.clientId))fail('not_found','Not found.',404);if(c.generation!==v.expectedGeneration)fail('connection_stale','Reload this connection.',409);
 if(await tx.get(index(c.clientId)))fail('removal_pending','Removal is already pending.',409);
 const snapshot=c.integration?.snapshot,manifest=snapshot?.manifest??c.integration?.manifest,declaration=manifest?.removal,state=c.state??(c.status==='active'?'active':'disconnected');
 if(!declaration||!['active','configuring','degraded','suspended'].includes(state)||state==='suspended'&&(c.suspensionReason!=='owner'||c.securitySuspended===true))fail('clean_removal_unavailable','This app cannot clean up. Remove it now instead.');
 const resumed=state==='suspended';if(resumed){if(typeof this.resume!=='function')fail('clean_removal_unavailable','Resuming this app is unavailable.');c=await this.resume(tx,owner,c);}
 const r={removal:owner+'.'+this.random.uuid(),entity:owner,client_id:c.clientId,connection:c.id,generation:c.generation,mode:'clean',state:'pending',started_at:now,cleanup_by:now+Math.min(declaration.cleanup_seconds??900,86400)*1000,declaration:structuredClone(declaration),confidential:snapshot?.authMethod==='private_key_jwt',binding,reissues:[],resumed,reminders:0};
 await tx.put(key(r.removal),r);await tx.put(index(c.clientId),r.removal);return r;});await this.wake(row.cleanup_by);return view(row);
 }
 async reissue(actor,value){const v=input(value,['removal','binding']),binding=await hash(v.binding);if(!binding)fail('invalid_request','A browser binding is required.',400);return this.metadata.transaction(async tx=>{const owner=await this.bound(tx,actor),r=await tx.get(key(v.removal));if(!removalOpen(r)||r.entity!==owner)fail('not_found','Not found.',404);const now=this.clock.now();r.reissues=(r.reissues??[]).filter(t=>t>now-86400000);if(r.reissues.length>=5)fail('rate_limited','Try again tomorrow.',429);r.reissues.push(now);r.binding=binding;await tx.put(key(r.removal),r);return view(r);});}
 async cancel(actor,value){const v=input(value,['removal']);return this.metadata.transaction(async tx=>{const owner=await this.bound(tx,actor),r=await tx.get(key(v.removal));if(!r||r.entity!==owner)return null;if(!removalOpen(r))return view(r);r.state='canceled';r.concluded_at=this.clock.now();await tx.put(key(r.removal),r);await tx.delete(index(r.client_id));return view(r);});}
 async conclude(actor,value,force=false){const v=input(value,force?['removal','connection','expectedGeneration']:['removal','outcome','result','binding','confirmed']),binding=await hash(v.binding);
 return this.metadata.transaction(async tx=>{const owner=await this.bound(tx,actor,true);if(force&&actor.kind==='app')fail('forbidden','Only the owner can force removal.',403);
 let r=await tx.get(key(v.removal));if(r?.entity!==owner)r=null;if(v.removal&&!r)return null;if(r&&!removalOpen(r))return actor.kind==='app'?null:view(r);
 if(!force&&!r)return null;if(actor.kind==='app'&&(actor.clientId!==r.client_id||!r.confidential||!r.declaration.back_channel))return null;
 if(!force&&!['completed','failed','in-progress','canceled'].includes(v.outcome))fail('invalid_request','Unsupported removal outcome.',400);
 if(!force&&actor.kind==='app'&&!['completed','failed'].includes(v.outcome))fail('invalid_request','Unsupported completion outcome.',400);
 if(!force&&actor.kind!=='app'&&binding!==r.binding&&v.confirmed!==true)return {...view(r),confirmation_required:true,reported_outcome:v.outcome,...result(v.result)?{reported_result:result(v.result)}:{}};
 const c=await this.connection(tx,owner,r?.connection??v.connection);if(c.generation!==(r?.generation??v.expectedGeneration)){if(force&&r)r.generation=c.generation;else return null;}
 if(!r){const now=this.clock.now();r={removal:owner+'.'+this.random.uuid(),entity:owner,client_id:c.clientId,connection:c.id,generation:c.generation,mode:'force',state:'pending',started_at:now};const open=await tx.get(index(c.clientId));if(open){const pending=await tx.get(key(open));if(removalOpen(pending)){r=pending;r.generation=c.generation;r.connection=c.id;}}}
 const validResult=result(v.result);if(validResult)r.result=validResult;
 if(!force&&v.outcome!=='completed'){if(v.outcome==='in-progress')r.state='in-progress';r.outcome=v.outcome;await tx.put(key(r.removal),r);return view(r);}
 if(typeof this.commit!=='function')fail('removal_unavailable','Removal is unavailable.',503);
 const committed=await this.commit(tx,{owner,clientId:r.client_id,connection:r.connection,expectedGeneration:r.generation});Object.assign(r,{state:force?'forced':'completed',outcome:force?'forced':'completed',committed_at:committed.committed_at,access_ends_by:committed.access_ends_by});await tx.put(key(r.removal),r);await tx.delete(index(r.client_id));return view(r);
 });
 }
 async tick(actor){return this.metadata.transaction(async tx=>{await this.bound(tx,actor,true);if(actor.kind!=='system')fail('forbidden','System only.',403);const now=this.clock.now();let wakeAt=null,notified=0;for(const [path,r]of await tx.list({prefix:REMOVAL_RECORD})){if(!removalOpen(r))continue;const times=[r.cleanup_by,r.cleanup_by+86400000,r.cleanup_by+7*86400000];while((r.reminders??0)<3&&times[r.reminders??0]<=now){const n=r.reminders??0;await tx.put(REMOVAL_NOTICE+r.removal+'/'+n,{owner:r.entity,clientId:r.client_id,removal:r.removal,at:now,kind:'app-removal-reminder',message:'This app has not finished cleaning up. Remove now?',primary:'force'});r.reminders=n+1;r.reminded_at??=now;notified++;}await tx.put(path,r);if(r.reminders<3)wakeAt=Math.min(wakeAt??Infinity,times[r.reminders]);}return {notified,wakeAt};});}
}
export function appRemovalProvider(service){return class extends Provider{static deps=[];obtain(){return service;}release(){}};}
export class RemovalList extends AppQuery{static operation='app-removal.list';static deps=['appRemoval'];static refreshOn=['app-removal-changed'];fetch({appRemoval}){return appRemoval.list(this.actor);}}
export class StartRemoval extends AppAction{static operation='app-removal.start';static deps=['appRemoval'];static changes='app-removal-changed';run({appRemoval}){return appRemoval.start(this.actor,this.input);}}
export class ReissueRemoval extends AppAction{static operation='app-removal.reissue';static deps=['appRemoval'];static changes='app-removal-changed';run({appRemoval}){return appRemoval.reissue(this.actor,this.input);}}
export class CancelRemoval extends AppAction{static operation='app-removal.cancel';static deps=['appRemoval'];static changes='app-removal-changed';run({appRemoval}){return appRemoval.cancel(this.actor,this.input);}}
export class CompleteRemoval extends AppAction{static operation='app-removal.complete';static deps=['appRemoval'];static changes='app-removal-changed';run({appRemoval}){return appRemoval.conclude(this.actor,this.input);}}
export class ForceRemoval extends AppAction{static operation='app-removal.force';static deps=['appRemoval'];static changes='app-removal-changed';run({appRemoval}){return appRemoval.conclude(this.actor,this.input,true);}}
export class RemovalReminderTick extends AppAction{static operation='app-removal.tick';static deps=['appRemoval'];static changes='app-removal-changed';static lifecycle='purging';run({appRemoval}){return appRemoval.tick(this.actor);}}
export const REMOVAL_OPERATIONS=[RemovalList,StartRemoval,ReissueRemoval,CancelRemoval,CompleteRemoval,ForceRemoval,RemovalReminderTick];
