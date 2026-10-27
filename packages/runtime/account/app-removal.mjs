import {ProducerSummaryService,producerSummaryProvider,RemovalRemaining,RemovalRemainingAction} from '../../storage/producer-summary.mjs';
import {createPushTransport} from '../../activity/web-push.mjs';
import {key} from '../../core/records.mjs';
// AU-S2/S4 account adapter. Actors and browser binding evidence are constructed by trusted HTTP adapters.
import {createAppEngine,perform,read,AppQuery,AppAction} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {AppConnections} from '../../apps/connections.mjs';
import {AppRemovalService,appRemovalProvider,REMOVAL_OPERATIONS,RemovalReminderTick,REMOVAL_RECORD,REMOVAL_NOTICE,removalOpen} from '../../app/domains/app-removal.mjs';
import {removalCommitTx,drainRemovalCascades} from '../app-removal-commit.mjs';
import {ownerFlags} from './flags.mjs';
import {assertDeletionFenceOpen} from '../account-deletion.mjs';
const engines=new WeakMap(),clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
const drain=async(c,owner)=>{const result=await drainRemovalCascades(c,owner,{now:clockOf(c)()});if(result.pending&&result.wakeAt!==null)await c.scheduleAlarm(result.wakeAt);return result;};
// RTC-i review M1: the owner and back-channel RPCs commit inside the account gate, then drain the durable cascade rows
// OUTSIDE it, as the alarm does. The external revocation (APP_REMOVAL_REVOKE_EXTERNAL: the owner's federation shard
// removalRevoke) runs the shard's boundSync hook, which calls this same account (rtcAppChanged, gated); and an RPC of
// the app being removed may hold the shard transaction while it waits on this account (tokenRecord's connection
// check). Awaiting the drain under the gate deadlocked both ways. The rows are durable and retried with backoff; a
// failed pass here leaves them to the alarm.
const underGate=async(c,operation)=>{const outcome=await c.gate.run(async()=>{try{await assertDeletionFenceOpen(c.metadata);return {value:await operation()};}catch(error){return {error};}});if(outcome.error)throw outcome.error;return outcome.value;};
const drainAfter=async(c,owner)=>{try{await drain(c,owner);}catch{try{await c.scheduleAlarm(Date.now()+60000);}catch{/* the next alarm retries */}}};
const boundStore=tx=>({get:k=>tx.get(k),put:(k,v)=>tx.put(k,v),delete:k=>tx.delete(k),list:o=>tx.list(o),transaction:fn=>fn(tx)});
export function removalEngine(c){let entry=engines.get(c);if(!entry){let producer;const clock={now:()=>clockOf(c)()},service=new AppRemovalService({metadata:c.metadata,clock,random:cryptoRandom,
 enabled:(owner,clientId)=>typeof c.config.INTEGRATION_EVENT_PORTS?.signer?.sign==='function'&&ownerFlags(c.config,owner,clientId).enabled('APP_CLEAN_REMOVAL_ENABLED'),wake:t=>c.scheduleAlarm(t),
 resume:(tx,owner,row)=>new AppConnections({metadata:boundStore(tx),origin:c.config.APP_ORIGIN,config:c.config,clock:clock.now}).transition(owner,row.id,'resume',{expectedGeneration:row.generation}),
 commit:(tx,options)=>removalCommitTx(c,tx,{...options,clock:clock.now})});entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,appRemoval:appRemovalProvider(service),producerSummary:producerSummaryProvider(producer=new ProducerSummaryService({metadata:c.metadata,clock,deleteObject:async({resource,object,commit})=>{if(resource.provider==='hosted')return c.hostedOperation(resource,'delete',{key:object.key,version:object.version},undefined,'@system',false,undefined,{commit});if(resource.provider==='google-drive')return c.googleDrive.delete(resource.owner,resource.id,{key:object.key,version:object.version},{commit});throw Object.assign(Error('This storage adapter cannot safely delete attributed data.'),{code:'unsupported_method',status:409});}}))}})};entry.producer=producer;service.notifyReminder=row=>dispatchRemovalReminder(c,row);engines.set(c,entry);}return entry;}
// Reuse the lifecycle's verified identity and fixed account-mail sender. Fetch current contact evidence:
// a cached lifecycle contact can outlive an email removal. No recipient or app text comes from the reminder.
export async function dispatchRemovalReminder(c,row){
 const push=c.config.LIFECYCLE_PUSH??(c.removalPush??=createPushTransport(c.config)),channels=[];let accepted=0,failed=0;
 if(typeof push?.send==='function')for(const sub of [...(await c.metadata.list({prefix:key('push-subscription',row.owner),limit:10})).values()].filter(s=>s.owner===row.owner).slice(0,10))try{await push.send(sub,{type:'bindle-removal-notice',owner:row.owner,path:`/console?account=${row.owner}&view=connections`});accepted++;channels.push('push');}catch{failed++;}
 const mail=c.config.APP_REMOVAL_MAIL??c.config.LIFECYCLE_MAIL,identityPort=c.config.APP_REMOVAL_IDENTITY??c.config.LIFECYCLE_IDENTITY;
 if(typeof mail?.sendAccountNotice==='function')try{const identity=await identityPort?.get(row.owner);if(identity?.verifiedEmail){await mail.sendAccountNotice({email:identity.verifiedEmail,type:'app-removal-reminder',owner:row.owner});accepted++;channels.push('email');}}catch{failed++;}
 return {accepted,failed,channels:[...new Set(channels)]};
}
// The durable reminder rows are the provider's activity entries, independent of email/push availability.
// They are kept separate from app-authored activity, which requires a live connection and app attestation.
export class RemovalReminderList extends AppQuery{
 static operation='app-removal.reminders';static deps=['appRemoval'];static refreshOn=['app-removal-changed'];
 async fetch({appRemoval:s}){if(this.actor?.kind!=='owner')throw Error('Owner only.');const input=this.input??{},limit=input.limit??50,cursor=input.cursor??'';if(!Number.isSafeInteger(limit)||limit<1||limit>100||typeof cursor!=='string'||cursor.length>1024||cursor&&!cursor.startsWith(REMOVAL_NOTICE))throw Object.assign(Error('Invalid reminder page.'),{code:'invalid_request',status:400});
 return s.metadata.transaction(async tx=>{const owner=await s.bound(tx,this.actor,true),items=[];let after=cursor,scanned=0,more=false;
 while(items.length<limit&&scanned<500){const pageLimit=Math.min(100,500-scanned),page=[...(await tx.list({prefix:REMOVAL_NOTICE,startAfter:after,limit:pageLimit})).entries()];if(!page.length){more=false;break;}for(const [path,n]of page){after=path;scanned++;const removal=n?.owner===owner?await tx.get(REMOVAL_RECORD+n.removal):null;if(removalOpen(removal)&&removal.entity===owner)items.push({id:path,kind:'app-removal-reminder',removal:n.removal,clientId:n.clientId,at:n.at,message:'This app has not finished cleaning up. It still has all its access.',primary:'force',actions:['force','wait'],path:`/console?account=${owner}&view=connections`});if(items.length===limit||scanned===500){more=true;break;}}if(items.length===limit||scanned===500)break;if(page.length<pageLimit){more=false;break;}}
 return {items,cursor:more?after:null};});}
}
// One best-effort attempt across configured notice channels per durable reminder. Reserve before I/O: a crash has an unknown outcome and
// never fabricates a delivery receipt. The console remains the durable notice surface without a push port.
async function* reminderRows(metadata){let startAfter='';for(;;){const page=[...(await metadata.list({prefix:REMOVAL_NOTICE,startAfter,limit:100})).entries()];yield* page;if(page.length<100)return;const next=page.at(-1)[0];if(next<=startAfter)throw Error('Invalid reminder pagination.');startAfter=next;}}
export class DeliverRemovalReminders extends AppAction{
 static deps=['appRemoval'];static operation='app-removal.deliver-reminders';
 async run({appRemoval:s}){const owner=this.actor?.owner;if(this.actor?.kind!=='system')throw Error('System only.');await s.metadata.transaction(tx=>s.bound(tx,this.actor,true));let attempted=0;
 for await(const [path]of reminderRows(s.metadata)){
  const row=await s.metadata.transaction(async tx=>{const n=await tx.get(path);if(n?.owner!==owner||n.attempted_at!==undefined)return null;const removal=await tx.get(REMOVAL_RECORD+n.removal);if(!removalOpen(removal))return null;await tx.put(path,{...n,attempted_at:s.clock.now(),outcome:'unknown'});return n;});if(!row)continue;
  let outcome='unavailable',accepted=0,channels=[];try{const result=await s.notifyReminder?.(row);if(result){accepted=result.accepted??0;channels=result.channels??[];outcome=accepted?'accepted':result.failed?'failed':'unavailable';}}catch{outcome='unknown';}
  await s.metadata.transaction(async tx=>{const n=await tx.get(path);if(n)await tx.put(path,{...n,outcome,accepted,channels});});attempted++;
 }return {attempted};}
}
export const methods={
 async appRemovalOwner(owner,{operation,input}={}){const Operation=[...REMOVAL_OPERATIONS,RemovalReminderList,RemovalRemaining,RemovalRemainingAction].find(O=>O.operation===operation&&O!==RemovalReminderTick);if(!Operation)throw Object.assign(Error('Not found.'),{code:'not_found',status:404});const engine=removalEngine(this).engine,op=new Operation({actor:{kind:'owner',owner},input});const result=await underGate(this,async()=>{await this.warm(owner);if(op instanceof AppQuery)return read(engine,op);const out=await perform(engine,op);await this.connectionsDrain(owner);await this.integrationEventsKick(owner);return out;});if(!(op instanceof AppQuery))await drainAfter(this,owner);return result;},
 async appRemovalComplete(owner,clientId,input){const Operation=REMOVAL_OPERATIONS.find(O=>O.operation==='app-removal.complete'),result=await underGate(this,async()=>{const out=await perform(removalEngine(this).engine,new Operation({actor:{kind:'app',owner,clientId},input}));await this.connectionsDrain(owner);await this.integrationEventsKick(owner);return out;});await drainAfter(this,owner);return result;},
 async appRemovalAlarm(){const owner=await this.metadata.get('owner');if(!owner)return;await drain(this,owner);const result=await perform(removalEngine(this).engine,new RemovalReminderTick({actor:{kind:'system',owner}}));await perform(removalEngine(this).engine,new DeliverRemovalReminders({actor:{kind:'system',owner}}));if(result.wakeAt!==null)await this.scheduleAlarm(result.wakeAt);
  // AU-S6: one bounded marker-sweep batch per alarm; reschedule while a pass is unfinished.
  const sweep=await removalEngine(this).producer.collectMarkers({limit:200});if(!sweep.done)await this.scheduleAlarm(Date.now()+1000);},
 // Local-only lookup for pinned back-channel admission; an unknown assertion must never trigger metadata fetches.
 async appRemovalAdmission(owner,id){if(await this.metadata.get('owner')!==owner)return null;const r=await this.metadata.get(REMOVAL_RECORD+id);if(!removalOpen(r)||r.entity!==owner||!r.confidential||!r.declaration.back_channel)return null;const c=await this.metadata.get('resource/'+r.connection);return c?.generation===r.generation?{removal:r.removal,clientId:r.client_id,snapshot:c.integration?.snapshot}:null;},
};
// Review M1: the two mutating entries take the account gate themselves (underGate) for the commit only.
export const rpc={appRemovalOwner:{lifecycle:'suspended',gate:'none'},appRemovalComplete:{lifecycle:'suspended',gate:'none'},appRemovalAdmission:{lifecycle:'suspended'}};
