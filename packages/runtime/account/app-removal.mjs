import {createPushTransport} from '../../messaging/web-push.mjs';
import {key} from '../../messaging/store.mjs';
// AU-S2/S4 account adapter. Actors and browser binding evidence are constructed by trusted HTTP adapters.
import {createAppEngine,perform,read,AppQuery,AppAction} from '../../app/engine.mjs';
import {cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {AppConnections} from '../../apps/connections.mjs';
import {AppRemovalService,appRemovalProvider,REMOVAL_OPERATIONS,RemovalReminderTick,REMOVAL_RECORD,REMOVAL_NOTICE,removalOpen} from '../../app/domains/app-removal.mjs';
import {removalCommitTx,drainRemovalCascades} from '../app-removal-commit.mjs';
import {ownerFlags} from './flags.mjs';
const engines=new WeakMap(),clockOf=c=>typeof c.config.LIFECYCLE_CLOCK==='function'?c.config.LIFECYCLE_CLOCK:Date.now;
const drain=async(c,owner)=>{const result=await drainRemovalCascades(c,owner,{now:clockOf(c)()});if(result.pending&&result.wakeAt!==null)await c.scheduleAlarm(result.wakeAt);return result;};
const boundStore=tx=>({get:k=>tx.get(k),put:(k,v)=>tx.put(k,v),delete:k=>tx.delete(k),list:o=>tx.list(o),transaction:fn=>fn(tx)});
export function removalEngine(c){let entry=engines.get(c);if(!entry){const clock={now:()=>clockOf(c)()},service=new AppRemovalService({metadata:c.metadata,clock,random:cryptoRandom,
 enabled:(owner,clientId)=>typeof c.config.INTEGRATION_EVENT_PORTS?.signer?.sign==='function'&&ownerFlags(c.config,owner,clientId).enabled('APP_CLEAN_REMOVAL_ENABLED'),wake:t=>c.scheduleAlarm(t),
 resume:(tx,owner,row)=>new AppConnections({metadata:boundStore(tx),origin:c.config.APP_ORIGIN,config:c.config,clock:clock.now}).transition(owner,row.id,'resume',{expectedGeneration:row.generation}),
 commit:(tx,options)=>removalCommitTx(c,tx,{...options,clock:clock.now})});entry={service,engine:createAppEngine({providers:{clock,random:cryptoRandom,audit:nullAudit,appRemoval:appRemovalProvider(service)}})};service.notifyReminder=async row=>{const push=c.config.LIFECYCLE_PUSH??(c.removalPush??=createPushTransport(c.config));if(typeof push?.send!=='function')return {accepted:0};let accepted=0,failed=0;for(const sub of [...(await c.metadata.list({prefix:key('push-subscription',row.owner),limit:10})).values()].filter(s=>s.owner===row.owner).slice(0,10))try{await push.send(sub,{type:'bindle-removal-notice',owner:row.owner});accepted++;}catch{failed++;}return {accepted,failed};};engines.set(c,entry);}return entry;}
// One best-effort push attempt per durable reminder. Reserve before I/O: a crash has an unknown outcome and
// never fabricates a delivery receipt. The console remains the durable notice surface without a push port.
async function* reminderRows(metadata){let startAfter='';for(;;){const page=[...(await metadata.list({prefix:REMOVAL_NOTICE,startAfter,limit:100})).entries()];yield* page;if(page.length<100)return;const next=page.at(-1)[0];if(next<=startAfter)throw Error('Invalid reminder pagination.');startAfter=next;}}
export class DeliverRemovalReminders extends AppAction{
 static deps=['appRemoval'];static operation='app-removal.deliver-reminders';
 async run({appRemoval:s}){const owner=this.actor?.owner;if(this.actor?.kind!=='system')throw Error('System only.');await s.metadata.transaction(tx=>s.bound(tx,this.actor,true));let attempted=0;
 for await(const [path]of reminderRows(s.metadata)){
  const row=await s.metadata.transaction(async tx=>{const n=await tx.get(path);if(n?.owner!==owner||n.attempted_at!==undefined)return null;const removal=await tx.get(REMOVAL_RECORD+n.removal);if(!removalOpen(removal))return null;await tx.put(path,{...n,attempted_at:s.clock.now(),outcome:'unknown'});return n;});if(!row)continue;
  let outcome='unavailable',accepted=0;try{const result=await s.notifyReminder?.(row);if(result){accepted=result.accepted??0;outcome=accepted?'accepted':result.failed?'failed':'unavailable';}}catch{outcome='unknown';}
  await s.metadata.transaction(async tx=>{const n=await tx.get(path);if(n)await tx.put(path,{...n,outcome,accepted});});attempted++;
 }return {attempted};}
}
export const methods={
 async appRemovalOwner(owner,{operation,input}={}){const Operation=REMOVAL_OPERATIONS.find(O=>O.operation===operation&&O!==RemovalReminderTick);if(!Operation)throw Object.assign(Error('Not found.'),{code:'not_found',status:404});await this.warm(owner);const engine=removalEngine(this).engine,op=new Operation({actor:{kind:'owner',owner},input});const result=op instanceof AppQuery?await read(engine,op):await perform(engine,op);if(!(op instanceof AppQuery)){await drain(this,owner);await this.connectionsDrain(owner);await this.integrationEventsKick(owner);}return result;},
 async appRemovalComplete(owner,clientId,input){const Operation=REMOVAL_OPERATIONS.find(O=>O.operation==='app-removal.complete'),result=await perform(removalEngine(this).engine,new Operation({actor:{kind:'app',owner,clientId},input}));await drain(this,owner);await this.connectionsDrain(owner);await this.integrationEventsKick(owner);return result;},
 async appRemovalAlarm(){const owner=await this.metadata.get('owner');if(!owner)return;await drain(this,owner);const result=await perform(removalEngine(this).engine,new RemovalReminderTick({actor:{kind:'system',owner}}));await perform(removalEngine(this).engine,new DeliverRemovalReminders({actor:{kind:'system',owner}}));if(result.wakeAt!==null)await this.scheduleAlarm(result.wakeAt);},
 // Local-only lookup for pinned back-channel admission; an unknown assertion must never trigger metadata fetches.
 async appRemovalAdmission(owner,id){if(await this.metadata.get('owner')!==owner)return null;const r=await this.metadata.get(REMOVAL_RECORD+id);if(!removalOpen(r)||r.entity!==owner||!r.confidential||!r.declaration.back_channel)return null;const c=await this.metadata.get('resource/'+r.connection);return c?.generation===r.generation?{removal:r.removal,clientId:r.client_id,snapshot:c.integration?.snapshot}:null;},
};
export const rpc={appRemovalOwner:{lifecycle:'suspended'},appRemovalComplete:{lifecycle:'suspended'},appRemovalAdmission:{lifecycle:'suspended'}};
