// Fragment member table (protocol §3, extensions revision 3.2; draft, unsigned except the fail-closed rule, EXT3-25,
// owner-approved 2026-10-27). One validator shared by the federation pins (packages/federation/schema.mjs) and the
// artefact growth rules (packages/core/artefacts.mjs), so the two never disagree again (extensions CR-X3-30).
//
// Outcomes are three, never partial semantics:
//   unsupported  a member the table does not list, at any level (top level, field, `cardinality`): a required
//                request fails with `unsupported_fragment`, an optional one is reported `unsupported`. A top-level
//                `slot` from extensions revision 2 is one such member (extensions §10).
//   invalid      a listed member used wrongly (missing where required, on a field type it does not apply to, out of
//                bounds).
//   valid        every member is listed and well formed.
// Pure: no I/O, no flags. Strings are plain text and bounded; contract URLs are canonical HTTPS identifiers.
export const FRAGMENT_TOP=Object.freeze(['id','title','description','publisher','fields']);
export const FRAGMENT_FIELD=Object.freeze(['title','description','type','cardinality','minLength','maxLength','minimum','maximum','values','extensible','contracts','selection','consumers','announce']);
export const FIELD_TYPES=Object.freeze(['string','boolean','integer','number','enum','url','resource']);
export const SELECTIONS=Object.freeze(['exclusive','ordered']);
export const CONSUMER_KINDS=Object.freeze(['application','provider']);
export const FIELD_NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const controls=/[\u0000-\u001f\u007f\u2028\u2029]/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max)=>typeof v==='string'&&v.length>0&&[...v].length<=max&&!controls.test(v);
const safe=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER;
/** Canonical HTTPS identifier (≤256, no userinfo, query, fragment or whitespace). */
export function httpsIdentifier(value){
 if(typeof value!=='string'||value.length>256||/[?#\s]/u.test(value)||controls.test(value))return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(u.href===value||u.origin===value);}catch{return false;}
}
class Outcome extends Error{constructor(status,reason){super(reason);this.status=status;this.reason=reason;}}
const unsupported=reason=>{throw new Outcome('unsupported',reason);};
const invalid=reason=>{throw new Outcome('invalid',reason);};
/** The effective cardinality, default exactly one. */
export const cardinalityOf=field=>field?.cardinality??{min:1,max:1};
/**
 * Member-table check of one field. `option` (extension descriptor options, extensions §2.4) allows `endpoint` on a
 * `url` option and forbids `resource` and the field attributes. `optionalTitle` keeps the legacy option metadata form
 * (titles optional). Throws an Outcome; callers use fieldOutcome/fragmentOutcome.
 */
function checkField(field,{option=false,optionalTitle=false}={}){
 if(!plain(field))invalid('invalid_field');
 const listed=option?[...FRAGMENT_FIELD.filter(k=>!['contracts','selection','consumers','announce'].includes(k)),'endpoint']:FRAGMENT_FIELD;
 for(const key of Object.keys(field))if(!listed.includes(key))unsupported('unknown_member');
 if(field.cardinality!==undefined){if(!plain(field.cardinality))invalid('invalid_cardinality');for(const key of Object.keys(field.cardinality))if(!['min','max'].includes(key))unsupported('unknown_member');}
 const type=field.type;if(!FIELD_TYPES.includes(type)||option&&type==='resource')invalid('invalid_type');
 if((!optionalTitle||field.title!==undefined)&&!text(field.title,200))invalid('invalid_title');
 if(field.description!==undefined&&!text(field.description,1000))invalid('invalid_description');
 const c=cardinalityOf(field);if(!Object.hasOwn(c,'min')||!Object.hasOwn(c,'max')||!Number.isSafeInteger(c.min)||!Number.isSafeInteger(c.max)||c.min<0||c.max<1||c.max>16||c.min>c.max)invalid('invalid_cardinality');
 if(['string','url'].includes(type)){if(!Number.isSafeInteger(field.maxLength)||field.maxLength<1||field.maxLength>2048||field.minLength!==undefined&&(!Number.isSafeInteger(field.minLength)||field.minLength<0||field.minLength>field.maxLength))invalid('invalid_length');}
 else if(field.minLength!==undefined||field.maxLength!==undefined)invalid('misapplied_member');
 if(['integer','number'].includes(type)){const ok=type==='integer'?Number.isSafeInteger:safe;if(!ok(field.minimum)||!ok(field.maximum)||field.minimum>field.maximum)invalid('invalid_range');}
 else if(field.minimum!==undefined||field.maximum!==undefined)invalid('misapplied_member');
 if(type==='enum'){if(!Array.isArray(field.values)||!field.values.length||field.values.length>32||new Set(field.values).size!==field.values.length||field.values.some(v=>!text(v,2048)))invalid('invalid_values');if(field.extensible!==undefined&&typeof field.extensible!=='boolean')invalid('invalid_extensible');}
 else if(field.values!==undefined||field.extensible!==undefined)invalid('misapplied_member');
 if(type==='resource'){
  if(!Array.isArray(field.contracts)||!field.contracts.length||field.contracts.length>16||new Set(field.contracts).size!==field.contracts.length||field.contracts.some(v=>!httpsIdentifier(v)))invalid('invalid_contracts');
  if(field.selection!==undefined){if(!SELECTIONS.includes(field.selection))invalid('invalid_selection');if(field.selection==='exclusive'?c.max!==1:c.max<2||c.max>8)invalid('invalid_selection');}
  if(field.consumers!==undefined&&(!Array.isArray(field.consumers)||!field.consumers.length||new Set(field.consumers).size!==field.consumers.length||field.consumers.some(v=>!CONSUMER_KINDS.includes(v))))invalid('invalid_consumers');
  if(field.announce!==undefined&&typeof field.announce!=='boolean')invalid('invalid_announce');
 }else for(const key of ['contracts','selection','consumers','announce'])if(field[key]!==undefined)invalid('misapplied_member');
 if(option){if(field.endpoint!==undefined&&(type!=='url'||!['audience','public'].includes(field.endpoint)))invalid('invalid_endpoint');}
}
/** {status:'valid'} | {status:'unsupported'|'invalid', reason} for one field. */
export function fieldOutcome(field,options={}){try{checkField(field,options);return {status:'valid'};}catch(error){if(error instanceof Outcome)return {status:error.status,reason:error.reason};throw error;}}
/** Whole-document check against the exhaustive member table. `url`: the URL the document was requested at. */
export function fragmentOutcome(doc,url=doc?.id){
 try{
  if(!plain(doc))invalid('invalid_schema');
  for(const key of Object.keys(doc))if(!FRAGMENT_TOP.includes(key))unsupported(key==='slot'?'slot_member':'unknown_member');
  // Unknown members anywhere win over invalid ones (review L7), so the outcome never depends on which member is wrong.
  if(plain(doc.fields))for(const field of Object.values(doc.fields)){if(plain(field)){for(const key of Object.keys(field))if(!FRAGMENT_FIELD.includes(key))unsupported('unknown_member');if(plain(field.cardinality))for(const key of Object.keys(field.cardinality))if(!['min','max'].includes(key))unsupported('unknown_member');}}
  if(!httpsIdentifier(url)||doc.id!==url)invalid('invalid_id');
  if(!text(doc.title,200)||!text(doc.description,2000))invalid('invalid_text');
  if(typeof doc.publisher!=='string')invalid('invalid_publisher');try{const u=new URL(doc.publisher);if(u.protocol!=='https:'||u.username||u.password||u.hash)invalid('invalid_publisher');}catch(error){if(error instanceof Outcome)throw error;invalid('invalid_publisher');}
  if(!plain(doc.fields))invalid('invalid_fields');const names=Object.keys(doc.fields);if(!names.length||names.length>32||names.some(n=>!FIELD_NAME.test(n)))invalid('invalid_fields');
  for(const field of Object.values(doc.fields))checkField(field);
  return {status:'valid'};
 }catch(error){if(error instanceof Outcome)return {status:error.status,reason:error.reason};throw error;}
}
/** Resource-field attributes with their defaults (extensions §3–§6). Only call on a valid resource field. */
export function fieldAttributes(field){
 return Object.freeze({selection:field.selection??null,consumers:Object.freeze([...(field.consumers??['application'])]),announce:field.announce===true,contracts:Object.freeze([...field.contracts]),max:cardinalityOf(field).max,min:cardinalityOf(field).min});
}
/** True when `kind` ('application' | 'provider') may request a grant on the field (extensions §4). */
export const consumes=(field,kind)=>field?.type==='resource'&&(field.consumers??['application']).includes(kind);
