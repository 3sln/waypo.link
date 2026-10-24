import {validateIntentDeclarations} from './declarations.mjs';
const ROOT='item-index/intent-handler/',READY='item-index/intent-handler-index/state',LEGACY_READY='item-index/intent-handler-index/v1';
/** Code epoch of the derived index. Bump it whenever `entries` changes, and on the first release after a rollback to
 * code that wrote resources without maintaining this index: a marker from any other epoch clears and rebuilds it. */
export const INTENT_INDEX_VERSION=1;
const prefix=(owner,kind)=>ROOT+encodeURIComponent(owner)+'/'+encodeURIComponent(kind)+'/';
const live=r=>r?.kind==='app-connection'&&r.status==='active'&&['active','degraded'].includes(r.state)&&(!r.entity||r.entity===r.owner)&&!r.organization;
function entries(r){if(!live(r))return [];const manifest=r.integration?.snapshot?.manifest??r.integration?.manifest;return validateIntentDeclarations(r.clientId,manifest?.intents).map(d=>[prefix(r.owner,d.kind)+String(d.version).padStart(4,'0')+'/'+encodeURIComponent(r.id),{...d,id:r.clientId,connection:r.id,generation:r.generation}]);}
async function update(tx,before,after){const next=new Map(entries(after));for(const [key]of entries(before))if(!next.has(key))await tx.delete(key);for(const [key,value]of next)await tx.put(key,value);}
// Rebuild in one storage transaction, in 100-row pages: drop every derived row (another epoch may have derived
// different keys or missed writes), then derive again from the authoritative resource records.
async function reconcile(tx){
 for(;;){const rows=await tx.list({prefix:ROOT,limit:100});for(const key of rows.keys())await tx.delete(key);if(rows.size<100)break;}
 let after='';for(;;){const rows=await tx.list({prefix:'resource/',startAfter:after,limit:100});for(const row of rows.values())await update(tx,null,row);if(rows.size<100)break;after=[...rows.keys()].at(-1);}
 await tx.delete(LEGACY_READY);await tx.put(READY,{version:INTENT_INDEX_VERSION});
}
const wrappers=new WeakMap();
/** A derived, transactional kind/version index. Resource records remain authoritative: callers recheck
 * each indexed connection and generation. The migration reads old accounts in bounded pages once. */
export function intentIndexedMetadata(store){
 if(store.intentHandlers)return store;if(wrappers.has(store))return wrappers.get(store);
 const wrap=tx=>new Proxy(tx,{get(target,name){
  if(name==='put')return async(key,value)=>{if(typeof key==='object'){for(const [k,v]of Object.entries(key))await wrap(tx).put(k,v);return;}const before=key.startsWith('resource/')?await tx.get(key):null;await tx.put(key,value);if(key.startsWith('resource/'))await update(tx,before,value);};
  if(name==='delete')return async keys=>{const before=[];for(const key of Array.isArray(keys)?keys:[keys])if(key.startsWith('resource/'))before.push(await tx.get(key));const result=await tx.delete(keys);for(const row of before)if(row)await update(tx,row,null);return result;};
  if(name==='intentHandlers')return async({owner,kind})=>{if((await tx.get(READY))?.version!==INTENT_INDEX_VERSION)await reconcile(tx);return [...(await tx.list({prefix:prefix(owner,kind)})).values()];};
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }});
 // Capture the underlying transaction once. Public method overrides (for tracing or adapters)
 // must wrap this layer without replacing the native method that this layer delegates to.
 const transaction=store.transaction.bind(store),overrides=new Map();
 const indexed=new Proxy(store,{get(target,name){
  if(overrides.has(name))return overrides.get(name);
  if(name==='transaction')return fn=>transaction(tx=>fn(wrap(tx)));
  if(name==='put'||name==='delete')return(...args)=>indexed.transaction(tx=>tx[name](...args));
  if(name==='intentHandlers')return input=>indexed.transaction(tx=>tx.intentHandlers(input));
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 },set(target,name,value){
  if(['transaction','put','delete','intentHandlers'].includes(name)){overrides.set(name,value);return true;}
  return Reflect.set(target,name,value);
 }});wrappers.set(store,indexed);return indexed;
}
