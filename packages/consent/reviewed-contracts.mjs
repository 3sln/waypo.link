import {contractMethods} from '../core/contract-methods.mjs';
// CX-1 catalogue data. Exact immutable source pins, not a host-wide review badge.
// Copy describes allowed effects only. Local/provisional; human release sign-off
// remains in docs/release/events-consent-review.md and docs/spec/security.md.
const method=(effect,en,es,categories=[])=>({effect,categories,text:{en,es}});
const base='https://3sln.me/artefacts/contracts/';
export const EVENT_BUS_CONTRACT='https://spec.bindle.example/contracts/event-bus/v1';
export const REVIEWED_CONTRACTS=freeze({
 [base+'profile/v1']:{source:'docs/artefacts/profile-v1.json',digest:'sha256-W36u9unuZTo-ARVFOwxsdwoYGeI6NjLMryA1vtcACzs',methods:{read:method('read','See your name, handle and picture','Ver tu nombre, alias y foto',['personal-data'])}},
 [base+'object-storage/v1']:{source:'docs/artefacts/object-storage-v1.json',digest:'sha256-H57hM0bXoXZ2G0EPYsiAr4sFzjQLJFzDfe8-AHhDzQQ',methods:{
  capabilities:method('read','See available file operations','Ver las operaciones disponibles para archivos'),get:method('read','See files','Ver archivos'),put:method('write','Add and replace files','Añadir y reemplazar archivos'),delete:method('destructive',"Delete files. This can't be undone.",'Eliminar archivos. No se puede deshacer.'),presign:method('write','Create temporary links to read or upload files','Crear enlaces temporales para leer o subir archivos'),
 }},
 [base+'resource-descriptor/v1']:{source:'docs/artefacts/resource-descriptor-v1.json',digest:'sha256-gQtIb95zYizUv5iGKFXDDsR8MgxVBz2xgjrg0vVhog0',methods:{describe:method('read','See resource details and available operations','Ver los detalles del recurso y las operaciones disponibles')}},
 [base+'resource-scoping/v1']:{source:'docs/artefacts/resource-scoping-v1.json',digest:'sha256-aBXaODzzKmFcbNXqefqFB66M2q9LXIuSeYAW5XVmy34',methods:{describe:method('read','See available access limits','Ver los límites de acceso disponibles')}},
 [base+'app-messages/v1']:{source:'docs/artefacts/app-messages-v1.json',digest:'sha256-6XQystTHUWKBE-ueUxrq7b0l3uKOPHhJVvHTOZwrZZQ',methods:{createOwn:method('write','Send you notifications in Activity','Enviarte notificaciones en Actividad')}},
 [EVENT_BUS_CONTRACT]:{source:'docs/artefacts/event-bus-v1.json',digest:'sha256-8cW7xawduTlyrtCD0LejglVwT2K4hryIQ7F0ZRJmwjY',methods:{read:method('read','See events in this feed','Ver eventos de esta fuente'),publish:method('write','Add events to this feed','Añadir eventos a esta fuente'),subscribe:method('read','Receive notices of new events in this feed','Recibir avisos de nuevos eventos de esta fuente'),unsubscribe:method('read','Stop notices of new events in this feed','Dejar de recibir avisos de nuevos eventos de esta fuente')}},
});
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}

// Compare the branches the implementer actually validates, including every local reference. A missing or
// nonlocal reference fails closed; a cycle keeps its pointer so recursive schemas remain comparable.
export function resolvedContractMethod(pin,name){
 const schema=pin?.schema??pin?.body;if(!schema||typeof schema!=='object')throw new TypeError('A pinned contract schema is required.');
 const resolve=(value,seen=new Set())=>{
  if(Array.isArray(value))return value.map(v=>resolve(v,seen));if(!value||typeof value!=='object')return value;
  if(Object.hasOwn(value,'$ref')&&Object.keys(value).length>1){const {$ref,...siblings}=value;return {allOf:[resolve({$ref},seen),resolve(siblings,seen)]};}
  const out=Object.create(null);if(Object.hasOwn(value,'$ref')){const ref=value.$ref;if(typeof ref!=='string'||ref!=='#'&&!ref.startsWith('#/'))throw new TypeError('Unresolved contract reference.');
   if(seen.has(ref))out.$ref=ref;else{let target=schema;for(const part of ref==='#'?[]:ref.slice(2).split('/')){const key=part.replaceAll('~1','/').replaceAll('~0','~');if(!target||typeof target!=='object'||!Object.hasOwn(target,key))throw new TypeError('Unresolved contract reference.');target=target[key];}Object.assign(out,resolve(target,new Set([...seen,ref])));}}
  for(const key of Object.keys(value).sort())if(key!=='$ref')out[key]=resolve(value[key],seen);return out;
 };
 const method=Object.hasOwn(contractMethods(schema),name)?contractMethods(schema)[name]:null;if(!method)throw new TypeError('Unknown contract method.');
 const request=method.request==='#'?Object.fromEntries(Object.entries(schema).filter(([key])=>!['$schema','$id','$defs','title','description'].includes(key)&&!key.startsWith('x-'))):typeof method.request==='string'?{$ref:method.request}:method.request??{};
 return {request:resolve(request),result:resolve(typeof method.result==='string'?{$ref:method.result}:method.result??{})};
}
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/** §10.5: a granted method whose fully resolved request/result grew is an updated delta item. Added
 * display strings stay visible even when they do not widen access. Inputs are already verified pins. */
export function contractUpgradeDelta(prior,next,methods){
 const updated=[],display=[],additions=[];for(const name of methods){
  const old=resolvedContractMethod(prior,name),target=resolvedContractMethod(next,name);if(stable(old)!==stable(target))updated.push(name);
  const added=(a,b,path)=>{if(!b||typeof b!=='object')return;for(const [key,value]of Object.entries(b)){const at=path+'/'+key.replaceAll('~','~0').replaceAll('/','~1');if(!a||!Object.hasOwn(a,key))additions.push({method:name,path:at,value:structuredClone(value)});else added(a[key],value,at);}};added(old,target,'');
  const before=contractMethods(prior.schema??prior.body)[name]?.summary??{},after=contractMethods(next.schema??next.body)[name]?.summary??{};
  for(const [lang,text]of Object.entries(after))if(!Object.hasOwn(before,lang))display.push({method:name,lang,text});
 }return {updated,display,...additions.length?{additions}:{}};
}
/** Keep copy only for the exact reviewed digest, or for branches proven unchanged from that reviewed pin. */
export function reviewedContractMethods(contract,pin,{reviewedPin}={}){
 const entry=REVIEWED_CONTRACTS[contract];if(!entry)return {};
 const bare=v=>String(v??'').replace(/^sha256-/,'');if(bare(pin?.digest)===bare(entry.digest))return entry.methods;
 if(!reviewedPin||bare(reviewedPin.digest)!==bare(entry.digest))return {};
 const methods={};for(const [name,copy]of Object.entries(entry.methods))try{if(!contractUpgradeDelta(reviewedPin,pin,[name]).updated.length)methods[name]=copy;}catch{}return methods;
}
