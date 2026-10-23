// AU-S3: one account-store commit; remote stores are durable cascades. Used by the removal engine provider,
// never as a second Action dispatch. The generation fence protects reinstallation from old completion/retry inputs.
import {DelegationRegistry} from '../identity/delegation.mjs';
import {AppConnections} from '../apps/connections.mjs';
import {busKeys,principalKey} from '../events/cursor.mjs';
import {cancelIntegrationDoorbell} from './integration-events.mjs';
import {AppAction} from '../app/engine.mjs';
import {StorageError} from '../storage/policy.mjs';
const CASCADE='app-removal/cascade/',STAMP='app-removal/commit/',pad=n=>String(n).padStart(16,'0');
const fail=(code,message,status)=>{throw new StorageError(code,message,status);};
async function* rows(tx,prefix){let startAfter='';for(;;){const page=[...(await tx.list({prefix,startAfter,limit:200})).entries()];for(const row of page)yield row;if(page.length<200)return;const next=page.at(-1)[0];if(next<=startAfter)fail('unavailable','Invalid storage pagination.',503);startAfter=next;}}
const boundStore=tx=>({get:key=>tx.get(key),put:(key,value)=>tx.put(key,value),delete:key=>tx.delete(key),list:options=>tx.list(options),transaction:fn=>fn(tx)});
export async function removalCommitTx(c,tx,{owner,clientId,connection,expectedGeneration,clock=()=>Date.now(),finalize,transaction}={}){
 if(typeof owner!=='string'||await tx.get('owner')!==owner)fail('not_found','Not found.',404);
 if(typeof clientId!=='string'||!clientId)fail('invalid_request','Name the app.',400);
 const apps=new AppConnections({metadata:boundStore(tx),origin:c.config.APP_ORIGIN,config:c.config,clock}),id=connection??await apps.id(owner,clientId),record=await tx.get('resource/'+id);
 if(record?.kind!=='app-connection'||record.owner!==owner||record.clientId!==clientId)fail('not_found','Not found.',404);
 if(expectedGeneration!==undefined&&record.generation!==expectedGeneration)fail('connection_stale','The connection changed. Reload and try again.',409);
 const previous=await tx.get(STAMP+id);let result;
 if(record.status==='disconnected'&&previous?.generation===record.generation)result={disconnected:true,app:apps.view(record),...previous};
 else{
  const now=clock();if(!Number.isSafeInteger(now)||now<0)fail('unavailable','Clock unavailable.',503);
  // Upgrade legacy tombstones so force removal always emits a terminal event and delegation cascade.
  if(record.state===undefined){record.state=record.status==='active'?'active':'disconnected';await tx.put('resource/'+id,record);}
  const disconnected=await apps.disconnect(owner,id,{expectedGeneration,reason:'uninstalled'}),current=await tx.get('resource/'+id);
  // Delegation status must be final at this commit even with integration flags off or a crashed cascade drain.
  const delegationTx={get:key=>tx.get(key),set:(key,value)=>tx.put(key,value),delete:key=>tx.delete(key),list:async prefix=>{const out=[];for await(const [key,value]of rows(tx,prefix))out.push({key,value});return out;}};
  await new DelegationRegistry({store:{transaction:fn=>fn(delegationTx)},issuer:c.config.APP_ORIGIN,clock}).revoke(owner,{kind:'system'},{clientId,reason:'uninstalled'});
  current.removalReason='uninstalled';current.severanceReason='uninstalled';if(current.notifications){if(!Number.isSafeInteger(current.notifications.generation)||current.notifications.generation>=Number.MAX_SAFE_INTEGER)fail('unavailable','Notification generation unavailable.',503);current.notifications={enabled:false,generation:current.notifications.generation+1};}await tx.put('resource/'+id,current);
  // A hosted record is detached; a consumer assignment is unassigned. Both queue the existing X8 severance format.
  const meta=await tx.get('integrations/meta')??{seq:0,low:0,health:{},hints:{}};
  const sever=async row=>{meta.seq++;if(meta.seq-(meta.low??0)>1024)await tx.put('integrations/severance/~'+row.connection,{seq:meta.seq,at:now,type:'overflow',connection:row.connection,generation:row.generation,grants:[]});else await tx.put('integrations/severance/'+pad(meta.seq),{seq:meta.seq,at:now,...row});};
  for await(const [key,r]of rows(tx,'integrations/record/')){
   if(r?.owner!==owner||r.v!==1)continue;
   const hosted=r.connection===id,gone=(r.assignments??[]).filter(a=>hosted||a.consumer?.clientId===clientId);
   if(hosted||gone.length)await sever({type:hosted?'detached':'unassigned',connection:r.connection,generation:r.generation,resource:r.resource,grants:gone.map(a=>a.grant)});
   if(hosted){await tx.delete(key);for await(const [index,value]of rows(tx,'integrations/resource/'))if(value===r.id)await tx.delete(index);}
   else if(gone.length){r.assignments=r.assignments.filter(a=>!gone.includes(a));await tx.put(key,r);}
  }
  await tx.put('integrations/meta',meta);
  for await(const [key,sub]of rows(tx,'evbus/sub/'))if(sub.connection===id||sub.clientId===clientId){await tx.delete(key);await cancelIntegrationDoorbell(tx,{connection:sub.connection,bus:sub.bus});}
  const keys=await busKeys(c.config);if(keys){const principal=await principalKey(keys,'client',`app:${clientId}`);for await(const [,bus]of rows(tx,'evbus/bus/'))if(bus.owner===owner){await tx.delete(`evbus/reader/${bus.id}/${principal}`);await tx.delete(`evbus/permit/${bus.id}/${principal}`);}}
  const stamp={connection:id,clientId,generation:current.generation,committed_at:now,access_ends_by:now+360000};await tx.put(STAMP+id,stamp);
  // Includes all generations up to the fence. A retried drain must never revoke grants of a later reconnect.
  await tx.put(CASCADE+id+'/'+pad(current.generation),{owner,...stamp});
  result={...disconnected,app:apps.view(current),...stamp};
 }
 const conclude=finalize??transaction;if(conclude)await conclude(tx,result);return result;
}
export async function removalCommit(c,options){return c.metadata.transaction(tx=>removalCommitTx(c,tx,options));}
export async function drainRemovalCascades(c,owner){
 let drained=0;for await(const [key,row]of rows(c.metadata,CASCADE)){
  if(row.owner!==owner)continue;
  if(typeof c.config.APP_REMOVAL_REVOKE_EXTERNAL!=='function')return {drained,pending:true};
  try{await c.config.APP_REMOVAL_REVOKE_EXTERNAL(structuredClone(row));}catch{return {drained,pending:true};}
  await c.metadata.transaction(async tx=>{const current=await tx.get(key);if(current?.generation===row.generation&&current.committed_at===row.committed_at)await tx.delete(key);});drained++;
 }
 return {drained,pending:false};
}

// Engine entry for direct force-removal compositions; clean completion uses the same transaction primitive.
export class CommitAppRemoval extends AppAction{static operation='app-removal.commit';static deps=['accountStore','config','clock'];static changes='app-removal-changed';run({accountStore,config,clock}){if(!['owner','system'].includes(this.actor?.kind))fail('unauthorized','Sign in to continue.',401);return removalCommit({metadata:accountStore,config},{...this.input,owner:this.actor.owner,clock:()=>clock.now()});}}
