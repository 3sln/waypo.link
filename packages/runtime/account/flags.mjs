// FF-5b: account-placement state predicates and request-local flag composition.
// No enrollment rows: predicates read existing records inside the writer gate.
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppQuery,createAppEngine,read,perform} from '../../app/engine.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {RecordFlagEvent} from '../../app/domains/flags.mjs';
import {key} from '../../core/records.mjs';
const scope=new AsyncLocalStorage();
export {capability,flagsFor,ownerFlags,siteEnabled,siteGlobal,existingFeature,featureConfig,surfaceConfig} from '../../flags/read.mjs';
import {flagsFor,ownerFlags,siteGlobal} from '../../flags/read.mjs';
export function writerConfig(config){return new Proxy(config,{get:(target,name,receiver)=>name==='EVENT_BUS_WAITS_MOUNTED'&&(target.flags||target.FLAGS)?!!target[name]&&siteGlobal(receiver,'EVENT_BUSES_ENABLED'):name==='BROKERED_INTROSPECTION_MOUNTED'&&(target.flags||target.FLAGS)?!!target[name]&&siteGlobal(receiver,'BROKERING_ENABLED')&&siteGlobal(receiver,'FEDERATION_ENABLED'):['flags','FLAGS'].includes(name)&&scope.getStore()?.config===target?scope.getStore().flags:Reflect.get(target,name,receiver)});}
const live=(row,owner)=>row?.owner===owner&&!row.revoked&&!['deleted','disconnected','revoked'].includes(row.state??row.status);
export class AccountFeatureState extends AppQuery{
 static deps=['accountStore','clock'];
 async fetch({accountStore:store,clock}){
  const owner=this.actor?.owner;if(!owner||await store.get('owner')!==owner)return {};
 const any=async(prefix,predicate)=>{let startAfter;for(;;){const rows=await store.list({prefix,limit:64,...startAfter?{startAfter}:{}});for(const row of rows.values())if(predicate(row))return true;if(rows.size<64)return false;startAfter=[...rows.keys()].at(-1);}},state={};
  state.ACTIVITY_V2_ENABLED=await any(key('activity-item',owner),r=>live(r,owner)&&r.state==='active'&&(r.expiresAt==null||r.expiresAt>clock.now()));
  state.EVENT_BUSES_ENABLED=await any('evbus/bus/',r=>live(r,owner)&&r.state==='active');
  // DX-1/DX-3 stateful flags: an existing export job or deletion request stays serviceable through a ramp-down.
  state.ACCOUNT_EXPORT_ENABLED=await store.get('export/active')!==undefined;
  state.ACCOUNT_DELETION_ENABLED=['scheduled','executing'].includes((await store.get('deletion/request-v1'))?.state);
  state.INTEGRATIONS_ENABLED=await any('resource/',r=>live(r,owner)&&r.kind==='app-connection'&&!!r.integration);
  state.EXTENSIONS_ENABLED=await any('connections/slot/',r=>r?.occupants?.length>0);
  state.LINKS_ENABLED=await any('link/',r=>live(r,owner))||await any(key('key-delegation',owner),r=>live(r,owner));
  // ORG-1: an organization's own account, and a person who is owner of record of one, stay serviceable.
  state.ORGANIZATIONS_ENABLED=(await store.get('org/record-v1'))?.kind==='organization'||await any('orgs/owned/',r=>typeof r?.org==='string');
  // Incremental grants and linked-device lineages live on the federation/identity
  // placements, not in this store; they cannot be inferred from account settings.
  return state;
 }
}
function backgroundPort(flags){
 const bind=ctx=>{const port=flags.for(ctx);return {...port,enabled:name=>name==='LIFECYCLE_DRY_RUN'?port.enabled(name):port.background(name)};};
 return {...flags,for:bind};
}
/** `config` is the original object behind writerConfig. The extra pin reuses
 * FF-4's snapshot/version fence while supplying the already-read predicates. */
export async function withWriterFlags(c,config,operation,{background=false}={}){
 const runtime=config.FLAGS_RUNTIME;if(!runtime)return operation();
 const state=background||!Object.values(runtime.entry?.snapshot?.flags??{}).some(r=>r.retainExisting)?{}:await read(c.engine,new AccountFeatureState({actor:{kind:'system',owner:await c.metadata.get('owner')}}));
 // Bind the owner once, without placing it in persisted state or telemetry.
 const owner=await c.metadata.get('owner'),retained=await runtime.pin({writer:true,minVersion:config.flags?.version??0,hasState:(name,subject)=>subject===owner&&state[name]===true});
 const pending=[];return scope.run({config,flags:background?backgroundPort(retained):retained,pending},async()=>{try{return await operation();}finally{await Promise.allSettled(pending);}});
}
/** Aggregate delivery is best effort. Never retry an uncertain increment and
 * never persist an assignment, owner/event receipt or delivery log. */
export function recordFlag(c,owner,name,kind,clientId){
 const decision=ownerFlags(c.config,owner,clientId).evaluate(name);if(!decision.experimentId||!decision.variant||!c.config.flagStats)return;
 const snapshot=c.config.FLAGS_RUNTIME?.entry?.snapshot,flagStore=c.config.flagStore??{get:async path=>{for(const [name,row]of Object.entries(snapshot?.flags??{}))if(path==='flag-experiment/'+row.experiment?.id)return {name,experiment:row.experiment};return null;}};
 const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,flagStore,flagStats:c.config.flagStats}}),pending=perform(engine,new RecordFlagEvent({actor:{kind:'system'},input:{experimentId:decision.experimentId,variant:decision.variant,kind,owner}})).catch(()=>{}).finally(()=>engine.dispose());
 if(c.config.EXECUTION?.waitUntil)c.config.EXECUTION.waitUntil(pending);
 else if(scope.getStore()?.pending){let timer;scope.getStore().pending.push(Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,250);})]).finally(()=>clearTimeout(timer)));}
 return pending;
}
