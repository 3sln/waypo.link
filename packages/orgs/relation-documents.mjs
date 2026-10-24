// ORG-10a relation documents (docs/architecture/organizations-design.md §8b.10; spec docs/spec/organizations.md §9.2,
// §9.8). Pure value operations plus the `RelationDocuments.resolve(pin)` port. A relation document is a public, versioned
// artefact of kind `relation` that bounds what may be granted; it grants nothing (spec §9.1), and neither its title nor a
// slot name ever authorizes anything.
//
// What this module does:
//   validateRelationBody   the §9.2 validator: bounds, `crit`, slots and arity, exact methods, `reshare:true` refused,
//                          superseding entries, and (with the pinned fragment bodies) fields, resource-field methods and
//                          the bus `entity` reader check (spec §11)
//   relationAdditive       the growth table of §9.2 ("Versioning: the relation kind and its growth points")
//   upgradeDelta           the per-pair delta between two pinned versions (non-empty means widening)
//   edgeEntries            the effective entries for one ordered (grantor slot, grantee slot) pair (superseding applied)
//   projectForSlot         "the matrix as it applies to slot X" (what X would give and receive)
//   relationEnvelope       builds an artefact envelope and its pins (fixtures and the future catalogue, RL-14)
//   relationDocuments      the resolve(pin) port: verifies the pinned version's hash chain, validates the body against
//                          its pinned fragments, and caches verified bodies by digest
//
// Provisional (coordinator) reconciliation, ORG-10a: the `relation` kind is NOT registered in DEFAULT_KINDS of
// packages/core/artefacts.mjs. Spec §9.2 says that until the growth table is signed, validators process `relation` as an
// unknown kind (artefacts §6.4): they use the versions they hold pins for and never advance a head. The table is
// implemented here (relationAdditive) so registration later is one row.
import {AppFault} from '../app/faults.mjs';
import {jcs,plain,scalarString,textEncoder} from '../core/strict-json.mjs';
import {parseReference,verifyReference,versionRecord,versionDigest,artefactURL,DIGEST_PATTERN} from '../core/artefacts.mjs';

export const RELATION_KIND='relation',RELATION_MAX_BYTES=32768,RELATION_PARTY_KINDS=Object.freeze(['person','organization']);
export const RELATION_LIMITS_DOC=Object.freeze({slots:8,entries:64,arity:1024,fields:32,methods:32,contracts:16});
const SLOT=/^[a-z][a-z0-9-]{0,31}$/,FIELD=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,METHOD=/^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const TEXT=/[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
const TOP=['id','title','description','publisher','crit','slots','access'];
const ENTRY=['grantor','grantee','required','fragment','version','digest','fields','methods','reshare','actor_disclosure'];
const fail=(code='relation_invalid',message='This relation document is invalid.',status=400)=>{throw new AppFault(code,message,status);};
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&scalarString(value)&&!TEXT.test(value);
const https=value=>{try{artefactURL(value);return true;}catch{return false;}};
const uniqueStrings=(value,max,pattern)=>Array.isArray(value)&&value.length>0&&value.length<=max&&new Set(value).size===value.length&&value.every(v=>typeof v==='string'&&pattern.test(v));
const has=(value,key)=>Object.hasOwn(value,key);
/** A slot of a validated document by name, own members only (a name such as `constructor` is never a slot). */
export const slotOf=(doc,name)=>typeof name==='string'&&doc?.slots&&Object.hasOwn(doc.slots,name)?doc.slots[name]:undefined;
export const pinKey=pin=>`${pin.artefact??pin.fragment}|${pin.version}|${pin.digest}`;
/** A relation pin {artefact, version, digest}; anything else (including a "latest" or legacy reference) is refused. */
export function relationPin(value){
 if(!plain(value)||Object.keys(value).some(k=>!['artefact','version','digest'].includes(k)))fail('relation_invalid','A pinned relation version is required.');
 let ref;try{ref=parseReference(value,{urlMember:'artefact',kind:RELATION_KIND});}catch{fail('relation_invalid','A pinned relation version is required.');}
 if(!ref.version||!ref.digest||ref.legacy)fail('relation_invalid','A pinned relation version is required.');
 return {artefact:ref.id,version:ref.version,digest:ref.digest};
}
const samePin=(a,b)=>a?.artefact===b?.artefact&&a?.version===b?.version&&a?.digest===b?.digest;
export {samePin};

function methodsValue(value){
 if(!plain(value)||Object.keys(value).length>RELATION_LIMITS_DOC.fields)return null;
 for(const [field,contracts] of Object.entries(value)){
  if(!FIELD.test(field)||!plain(contracts)||!Object.keys(contracts).length||Object.keys(contracts).length>RELATION_LIMITS_DOC.contracts)return null;
  for(const [contract,methods] of Object.entries(contracts))if(!https(contract)||!uniqueStrings(methods,RELATION_LIMITS_DOC.methods,METHOD))return null;
 }
 return value;
}
const coversMethods=(wide,narrow)=>Object.entries(narrow??{}).every(([field,contracts])=>Object.entries(contracts).every(([c,ms])=>ms.every(m=>wide?.[field]?.[c]?.includes(m))));
const fieldsCover=(wide,narrow)=>wide===undefined||narrow!==undefined&&narrow.every(f=>wide.includes(f));

/**
 * Validates one version's body (spec §9.2). `id`, when given, must equal the body's `id`. `fragment(pin)` returns the
 * pinned fragment (or slot or bus manifest) body, or undefined; when it is supplied, every entry's fragment must be
 * available. Returns a normalized copy: {id, title, description, publisher, slots, access:[{index, ...}]}. Throws
 * `relation_invalid` (uniform) on anything else.
 */
export function validateRelationBody(body,{id,fragment}={}){
 if(!plain(body))fail();
 let encoded;try{encoded=jcs(body,{maxDepth:12});}catch{fail();}
 if(textEncoder.encode(encoded).byteLength>RELATION_MAX_BYTES)fail();
 // Unknown members are ignored unless named in `crit`; this processor implements no extension, so any `crit` entry
 // makes the document invalid here (fail closed, spec §9.2 "Processing").
 if(!Array.isArray(body.crit)||body.crit.length)fail();
 if(!https(body.id)||id!==undefined&&body.id!==id||!text(body.title,200)||has(body,'description')&&!text(body.description,2000))fail();
 if(has(body,'publisher')&&!https(body.publisher))fail();
 if(!plain(body.slots))fail();
 const slotNames=Object.keys(body.slots);if(!slotNames.length||slotNames.length>RELATION_LIMITS_DOC.slots)fail();
 const slots={};
 for(const name of slotNames){
  const s=body.slots[name];if(!SLOT.test(name)||!plain(s)||!plain(s.arity)||Object.keys(s.arity).some(k=>!['min','max'].includes(k)))fail();
  const {min,max}=s.arity;if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<0||min>max||max>RELATION_LIMITS_DOC.arity||max<1)fail();
  if(!Array.isArray(s.kinds)||!s.kinds.length||new Set(s.kinds).size!==s.kinds.length||s.kinds.some(k=>!RELATION_PARTY_KINDS.includes(k)))fail();
  if(has(s,'title')&&!text(s.title,200)||has(s,'description')&&!text(s.description,2000))fail();
  slots[name]={...has(s,'title')?{title:s.title}:{},arity:{min,max},kinds:[...s.kinds]};
 }
 if(!Array.isArray(body.access)||!body.access.length||body.access.length>RELATION_LIMITS_DOC.entries)fail();
 const access=body.access.map((e,index)=>{
  if(!plain(e)||!has(e,'methods'))fail();
  if(!has(slots,e.grantor)||!has(slots,e.grantee))fail();
  let ref;try{ref=parseReference({fragment:e.fragment,version:e.version,digest:e.digest},{urlMember:'fragment'});}catch{fail();}
  if(!ref.version||!DIGEST_PATTERN.test(e.digest??''))fail();
  if(has(e,'fields')&&!uniqueStrings(e.fields,RELATION_LIMITS_DOC.fields,FIELD))fail();
  const methods=methodsValue(e.methods);if(!methods)fail();
  if(has(e,'fields')&&Object.keys(methods).some(f=>!e.fields.includes(f)))fail();
  if(has(e,'required')&&typeof e.required!=='boolean')fail();
  // This version refuses reshare:true (spec §9.2, §9.7): no onward sharing.
  if(has(e,'reshare')&&e.reshare!==false)fail();
  if(has(e,'actor_disclosure')&&!['pairwise','named'].includes(e.actor_disclosure))fail();
  const out={index,grantor:e.grantor,grantee:e.grantee,fragment:e.fragment,version:e.version,digest:e.digest,...has(e,'fields')?{fields:[...e.fields]}:{},methods:structuredClone(methods),required:e.required??true,reshare:false,actor_disclosure:e.actor_disclosure??'pairwise'};
  if(typeof fragment==='function'){
   const f=fragment({fragment:e.fragment,version:e.version,digest:e.digest});
   if(!plain(f)||!plain(f.fields))fail('relation_unavailable','A fragment this relation pins is unavailable.',409);
   const covered=out.fields??Object.keys(f.fields);
   if(covered.some(name=>!plain(f.fields[name])))fail();
   for(const name of covered){const field=f.fields[name];
    if(field.type==='resource'){const m=methods[name];if(!m)fail();if(Object.keys(m).some(c=>!(field.contracts??[]).includes(c)))fail();}
    else if(has(methods,name))fail();
   }
   if(Object.keys(methods).some(name=>!covered.includes(name)))fail();
   // A bus manifest may appear only if it lists `entity` among its readers (spec §11).
   if(plain(f.slot?.bus)&&!(Array.isArray(f.slot.bus.readers)&&f.slot.bus.readers.includes('entity')))fail();
  }
  return out;
 });
 // Superseding entries (spec §9.2): a later entry for the same (grantor, grantee, fragment line) needs a higher fragment
 // version and embeds the earlier entry's grants (same required and ceilings, fields ⊇, methods ⊇).
 for(const e of access)for(const prior of access.slice(0,e.index))if(prior.grantor===e.grantor&&prior.grantee===e.grantee&&prior.fragment===e.fragment){
  if(e.version<=prior.version||e.required!==prior.required||e.actor_disclosure!==prior.actor_disclosure||!fieldsCover(e.fields,prior.fields)||!coversMethods(e.methods,prior.methods))fail();
 }
 return {id:body.id,title:body.title,...has(body,'description')?{description:body.description}:{},...has(body,'publisher')?{publisher:body.publisher}:{},slots,access};
}

/** The effective entries for the ordered slot pair (grantor slot → grantee slot): entries superseded by a later entry of
 * the same fragment line are dropped. Each keeps its index in the pinned version. */
export function edgeEntries(doc,grantorSlot,granteeSlot){
 const pair=doc.access.filter(e=>e.grantor===grantorSlot&&e.grantee===granteeSlot);
 return pair.filter(e=>!pair.some(later=>later.index>e.index&&later.fragment===e.fragment));
}
/** What an entity in `slot` would give and receive under this document, entry by entry (the disclosure basis). */
export function projectForSlot(doc,slot){
 if(!slotOf(doc,slot))fail('relation_slot_invalid','That slot is not part of this relation.');
 const view=e=>({index:e.index,fragment:{fragment:e.fragment,version:e.version,digest:e.digest},...e.fields?{fields:[...e.fields]}:{},methods:structuredClone(e.methods),required:e.required,actor_disclosure:e.actor_disclosure});
 const gives=[],receives=[];
 for(const other of Object.keys(doc.slots)){
  for(const e of edgeEntries(doc,slot,other))gives.push({to:other,...view(e)});
  for(const e of edgeEntries(doc,other,slot))receives.push({from:other,...view(e)});
 }
 return {relation:doc.id,title:doc.title,...doc.publisher?{publisher:doc.publisher,publisherVerified:false}:{},slot,slotTitle:slotOf(doc,slot).title??null,arity:{...slotOf(doc,slot).arity},gives,receives};
}

/**
 * The growth table (spec §9.2). Returns true when `next` is an additive successor of `old`; otherwise false. Both bodies
 * must validate. Never additive: changing id, crit, publisher or any text; slot names, arity or kinds; any member of an
 * existing entry other than appending to its `fields`/`methods` as the table allows; adding a top-level member; removing,
 * reordering or narrowing anything.
 */
export function relationAdditive(old,next){
 try{validateRelationBody(old);validateRelationBody(next);}catch{return false;}
 const same=(a,b)=>jcs(a)===jcs(b);
 const keys=v=>Object.keys(v).sort();
 if(!same(keys(old),keys(next)))return false;
 for(const k of Object.keys(old))if(!['slots','access'].includes(k)&&!same(old[k],next[k]))return false;
 for(const [name,s] of Object.entries(old.slots))if(!has(next.slots,name)||!same(s,next.slots[name]))return false;
 for(const [name,s] of Object.entries(next.slots))if(!has(old.slots,name)&&!(plain(s.arity)&&has(s.arity,'min')&&s.arity.min===0))return false;
 if(next.access.length<old.access.length)return false;
 for(let i=0;i<old.access.length;i++){
  const a=old.access[i],b=next.access[i];
  if(!same(keys(a),keys(b)))return false;
  for(const k of Object.keys(a))if(!['fields','methods'].includes(k)&&!same(a[k],b[k]))return false;
  let added=[];
  if(has(a,'fields')){if(b.fields.length<a.fields.length||!same(b.fields.slice(0,a.fields.length),a.fields))return false;added=b.fields.slice(a.fields.length);}
  for(const [field,contracts] of Object.entries(a.methods)){
   if(!has(b.methods,field)||!same(keys(contracts),keys(b.methods[field])))return false;
   for(const [c,ms] of Object.entries(contracts))if(b.methods[field][c].length<ms.length||!same(b.methods[field][c].slice(0,ms.length),ms))return false;
  }
  for(const field of Object.keys(b.methods))if(!has(a.methods,field)&&!added.includes(field))return false;
 }
 for(let i=old.access.length;i<next.access.length;i++){
  const e=next.access[i],required=e.required??true;
  const supersedes=next.access.slice(0,i).some(p=>p.grantor===e.grantor&&p.grantee===e.grantee&&p.fragment===e.fragment);
  if(required&&!supersedes&&old.access.some(p=>p.grantor===e.grantor&&p.grantee===e.grantee))return false;
 }
 return true;
}

/** The widening delta for one ordered pair between pinned versions `old` → `next` (spec §9.2 "Upgrades"): appended or
 * superseding entries, appended fields and appended methods. Empty means the pin may advance without asking. */
export function upgradeDelta(old,next,grantorSlot,granteeSlot){
 if(!relationAdditive(old,next))fail('relation_not_additive','This relation version is not an additive successor.',409);
 const a=validateRelationBody(old),b=validateRelationBody(next),delta=[];
 for(const e of b.access){if(e.grantor!==grantorSlot||e.grantee!==granteeSlot)continue;
  const prior=a.access[e.index];
  if(!prior){delta.push({kind:'entry',index:e.index});continue;}
  const fields=(e.fields??[]).filter(f=>!(prior.fields??[]).includes(f));if(fields.length)delta.push({kind:'fields',index:e.index,fields});
  for(const [field,contracts] of Object.entries(e.methods))for(const [c,ms] of Object.entries(contracts)){const added=ms.filter(m=>!prior.methods[field]?.[c]?.includes(m));if(added.length)delta.push({kind:'methods',index:e.index,field,contract:c,methods:added});}
 }
 return delta;
}

/** Builds an artefact envelope of kind `relation` from successive bodies, with the pin of each version. */
export async function relationEnvelope(id,bodies,{crypto=globalThis.crypto}={}){
 const versions=[],pins=[];let prev=null;
 for(const [i,body] of bodies.entries()){const entry={version:i+1,prev,body};const digest=await versionDigest(versionRecord({id,kind:RELATION_KIND},entry),{crypto});versions.push(entry);pins.push({artefact:id,version:i+1,digest});prev=digest;}
 return {envelope:{bindle_artefact:1,id,kind:RELATION_KIND,versions},pins};
}

/**
 * The RelationDocuments port. `fetch(artefactId)` returns the artefact envelope (or null) through the provider's trusted
 * artefact path; `fragment(pin)` returns a pinned fragment body (or undefined). `resolve(pin)` verifies the pinned
 * version's hash chain (spec §9.8 item 3), validates it against its pinned fragments and returns {pin, doc}. Verified
 * bodies are cached by digest in memory; callers also keep a durable copy per pin (spec §9.8 item 4), so instances keep
 * working when the document disappears. Every failure is `relation_unavailable` or `relation_invalid`.
 */
export function relationDocuments({fetch,fragment,crypto=globalThis.crypto,limit=256}={}){
 const cache=new Map();
 return Object.freeze({
  async resolve(input){
   const pin=relationPin(input),hit=cache.get(pin.digest);if(hit&&samePin(hit.pin,pin))return structuredClone(hit);
   let envelope;try{envelope=await fetch(pin.artefact);}catch{envelope=null;}
   if(!envelope)fail('relation_unavailable','This relation document is unavailable.',409);
   let body;try{({body}=await verifyReference(envelope,pin,{kind:RELATION_KIND,crypto}));}catch{fail('relation_unavailable','This relation document is unavailable.',409);}
   const fragments=new Map();
   if(typeof fragment==='function')for(const e of Array.isArray(body.access)?body.access:[]){const p={fragment:e?.fragment,version:e?.version,digest:e?.digest};let f;try{f=await fragment(p);}catch{f=undefined;}fragments.set(pinKey(p),f);}
   const doc=validateRelationBody(body,{id:pin.artefact,...typeof fragment==='function'?{fragment:p=>fragments.get(pinKey(p))}:{}});
   const value={pin,doc};if(cache.size>=limit)cache.delete(cache.keys().next().value);cache.set(pin.digest,value);return structuredClone(value);
  }
 });
}
