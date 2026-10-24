// Derived indexes contain pointers only; object and removal records remain authoritative.
const ROOT='storage/producer-gc/index/',STATE=ROOT+'ready';
const enc=encodeURIComponent,gen=n=>String(n).padStart(16,'0');
export const producerIndexPrefix=(kind,connection)=>ROOT+kind+'/'+enc(connection)+'/';
export const producerIndexGeneration=gen;
function entries(key,v){
 if(!v)return [];
 if(key.startsWith('hosted/')||key.startsWith('drive/object/'))return ['producer','createdBy'].flatMap(kind=>{const m=v[kind];if(kind==='createdBy'&&m?.connection===v.producer?.connection&&m?.generation===v.producer?.generation)return [];return typeof m?.connection==='string'&&Number.isSafeInteger(m.generation)?[[producerIndexPrefix(kind,m.connection)+gen(m.generation)+'/'+enc(key),{path:key}]]:[];});
 if(key.startsWith('app-removal/record/')||key.startsWith('storage/producer-lineage/'))return typeof v.connection==='string'&&Number.isSafeInteger(v.generation)?[[producerIndexPrefix(key.startsWith('app-removal/')?'removal':'lineage',v.connection)+gen(v.generation)+'/'+enc(key),{path:key}],...key.startsWith('storage/producer-lineage/')&&!v.swept?[[ROOT+'pending/'+enc(key),{path:key}]]:[]]:[];
 if(key.startsWith('storage/producer-keep/')&&v.action==='keep'&&v.active===true&&Number.isSafeInteger(v.generation))return [[producerIndexPrefix('keep',v.connection)+enc(v.resource??'~all')+'/'+gen(Number.MAX_SAFE_INTEGER-v.generation)+'/'+enc(v.removal),{path:key,generation:v.generation,removal:v.removal,resource:v.resource,connection:v.connection}]];
 return [];
}
const relevant=k=>k.startsWith('hosted/')||k.startsWith('drive/object/')||k.startsWith('app-removal/record/')||k.startsWith('storage/producer-lineage/')||k.startsWith('storage/producer-keep/');
const wrappers=new WeakMap();
export function producerIndexedMetadata(store){
 if(store.producerIndexReady)return store;if(wrappers.has(store))return wrappers.get(store);
 const transaction=store.transaction.bind(store),overrides=new Map();
 const wrap=tx=>new Proxy(tx,{get(target,name){
  if(name==='put')return async(k,v)=>{if(typeof k==='object'){for(const [key,value]of Object.entries(k))await wrap(tx).put(key,value);return;}if(relevant(k)&&!await tx.get(STATE)&&!await tx.get(ROOT+'migration')){let legacy=false;for(const prefix of ['hosted/','drive/object/','app-removal/record/','storage/producer-lineage/','storage/producer-keep/'])if((await tx.list({prefix,limit:1})).size){legacy=true;break;}if(!legacy)await tx.put(STATE,true);else await tx.put(ROOT+'migration',{root:0,after:''});}const before=relevant(k)?await tx.get(k):null;await tx.put(k,v);if(relevant(k)){const prior=new Map(entries(k,before)),next=new Map(entries(k,v));for(const [key]of prior)if(!next.has(key))await tx.delete(key);for(const [key,value]of next)if(JSON.stringify(prior.get(key))!==JSON.stringify(value))await tx.put(key,value);}};
  if(name==='delete')return async keys=>{for(const k of Array.isArray(keys)?keys:[keys]){if(relevant(k))for(const [key]of entries(k,await tx.get(k)))await tx.delete(key);await tx.delete(k);}};
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 }});
 const proxy=new Proxy(store,{get(target,name){if(overrides.has(name))return overrides.get(name);
  if(name==='producerIndexReady')return async()=>transaction(async tx=>{if(await tx.get(STATE))return true;let state=await tx.get(ROOT+'migration')??{root:0,after:''};const roots=['hosted/','drive/object/','app-removal/record/','storage/producer-lineage/','storage/producer-keep/'];let remaining=200;while(state.root<roots.length&&remaining){const rows=await tx.list({prefix:roots[state.root],startAfter:state.after,limit:remaining});for(const [k,v]of rows)for(const [key,value]of entries(k,v))await tx.put(key,value);remaining-=rows.size;if(rows.size===0||remaining>0){state.root++;state.after='';}else state.after=[...rows.keys()].at(-1);}if(state.root===roots.length){await tx.put(STATE,true);await tx.delete(ROOT+'migration');return true;}await tx.put(ROOT+'migration',state);return false;});
  if(name==='transaction')return fn=>transaction(tx=>fn(wrap(tx)));
  if(name==='put'||name==='delete')return(...args)=>proxy.transaction(tx=>tx[name](...args));
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
 },set(target,name,value){if(['transaction','put','delete','list'].includes(name)){overrides.set(name,value);return true;}return Reflect.set(target,name,value);}});wrappers.set(store,proxy);return proxy;
}
