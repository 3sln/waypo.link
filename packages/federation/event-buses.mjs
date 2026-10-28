import {siteGlobal} from '../flags/read.mjs';
import {AppAction,AppQuery} from '../app/engine.mjs';
import {canonical} from '../core/records.mjs';
import {canonical as canonicalJSON,digest} from '../core/records.mjs';
import {fail,object,strings,https,pinVersioned,validateSchema,validateFields} from './schema.mjs';

export const EVENT_BUS_CONTRACT='https://spec.bindle.example/contracts/event-bus/v1';
const BUS_KEYS=['v','types','payload','max_record_bytes','retention','publishers','readers','history','categories','effects'];
const SCHEMA_KEYS=['type','enum','const','properties','required','additionalProperties','items','maxItems','maxLength','format','minimum','maximum','multipleOf'],TYPES=['object','array','string','integer','number','boolean','null'];
const own=(value,key)=>object(value)&&Object.hasOwn(value,key),bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const exact=(value,keys)=>{if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('invalid_bus');};
const subset=value=>{strings(value,2);if(!value.length||value.some(kind=>!['application','provider'].includes(kind)))fail('invalid_bus');};
// BCP 47 syntax, including private-use and grandfathered tags that Intl may not support.
const locale=/^(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-[a-z]{2}|-\d{3})?(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?|x(?:-[a-z0-9]{1,8})+|en-GB-oed|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|sgn-(?:BE-FR|BE-NL|CH-DE))$/i;
const grandfathered=new Set('art-lojban cel-gaulish en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu no-bok no-nyn sgn-be-fr sgn-be-nl sgn-ch-de zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang'.split(' '));
function languageTag(tag){if(!locale.test(tag))return false;try{Intl.getCanonicalLocales(tag);return true;}catch{return /^x-/i.test(tag)||grandfathered.has(tag.toLowerCase());}}
function effects(value){
 exact(value,['read','write']);
 for(const mode of ['read','write']){
  const map=value[mode];if(!object(map)||!own(map,'en')||Object.keys(map).length>8)fail('invalid_bus');
  const seen=new Set();for(const [tag,text] of Object.entries(map)){const key=tag.toLowerCase();if(!languageTag(tag)||seen.has(key)||typeof text!=='string'||!text.trim()||[...text].length>200||/[\u0000-\u001f\u007f]/.test(text))fail('invalid_bus');seen.add(key);}
 }
}
function payloadSchema(schema,depth=1,budget={properties:0}){
 exact(schema,SCHEMA_KEYS);if(depth>6)fail('invalid_bus_schema');
 const types=Array.isArray(schema.type)?schema.type:[schema.type];if(!types.length||new Set(types).size!==types.length||types.some(type=>!TYPES.includes(type)))fail('invalid_bus_schema');
 if(own(schema,'enum')&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>64||new Set(schema.enum.map(canonical)).size!==schema.enum.length))fail('invalid_bus_schema');
 if(types.includes('object')&&schema.additionalProperties!==false)fail('invalid_bus_schema');
 if(own(schema,'additionalProperties')&&schema.additionalProperties!==false)fail('invalid_bus_schema');
 if(own(schema,'properties')){
  if(!object(schema.properties))fail('invalid_bus_schema');budget.properties+=Object.keys(schema.properties).length;if(budget.properties>128)fail('invalid_bus_schema');
  for(const child of Object.values(schema.properties))payloadSchema(child,depth+1,budget);
 }
 if(own(schema,'required')){if(!Array.isArray(schema.required)||new Set(schema.required).size!==schema.required.length||schema.required.some(key=>typeof key!=='string'||!own(schema.properties,key)))fail('invalid_bus_schema');}
 if(types.includes('array')&&(!own(schema,'items')||!integer(schema.maxItems,0,256)))fail('invalid_bus_schema');
 if(own(schema,'maxItems')&&!integer(schema.maxItems,0,256))fail('invalid_bus_schema');if(own(schema,'items'))payloadSchema(schema.items,depth+1,budget);
 if(types.includes('string')&&!integer(schema.maxLength,0,4096))fail('invalid_bus_schema');
 if(own(schema,'maxLength')&&!integer(schema.maxLength,0,4096)||own(schema,'format')&&!['uri','date-time','uuid'].includes(schema.format))fail('invalid_bus_schema');
 for(const key of ['minimum','maximum','multipleOf'])if(own(schema,key)&&(!Number.isFinite(schema[key])||types.includes('integer')&&Math.abs(schema[key])>Number.MAX_SAFE_INTEGER||key==='multipleOf'&&schema[key]<=0))fail('invalid_bus_schema');
 if(own(schema,'minimum')&&own(schema,'maximum')&&schema.minimum>schema.maximum)fail('invalid_bus_schema');
 // Values of enum/const are JSON literals, not schema nodes; the same depth/property
 // budget does not apply to them. The complete document remains bounded to 16 KiB.
 for(const value of [...schema.enum??[],...own(schema,'const')?[schema.const]:[]])if(types.includes('integer')&&typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value))fail('invalid_bus_schema');
}

// Legacy bus manifests (events spec, pending extensions CR-X3-09). Extensions revision 3.2 removed slots, and the
// fail-closed fragment member table makes any fragment with a top-level `slot` unsupported (protocol §3), so a bus
// manifest is never processed as an ordinary fragment. Until CR-X3-09 turns bus semantics into an events-extension
// field member, the events store validates its own legacy container here, self-contained: the fragment part against
// the member table and the `slot` container (exclusive, one event-bus resource field, `crit` naming `bus`).
// TODO(extensions CR-X3-09): replace with a fragment field member defined by the events extension.
const SLOT_KEYS=['v','crit','field','selection','consumers','options','bus'];
const busDigest=async(crypto,schema)=>'sha256-'+await digest(crypto,canonicalJSON(schema));
const validDigest=value=>{if(typeof value!=='string'||!/^sha256-[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value))fail('invalid_digest');return value;};
export function validateBusManifest(schema,url=schema?.id){
 if(!object(schema))fail('invalid_schema');https(url);
 const {slot,...plainFragment}=schema;validateSchema(plainFragment,url);const fragment=structuredClone(schema);
 if(!own(schema,'slot'))return {status:'absent',schema:fragment};
 if(!object(slot))return {status:'invalid',schema:fragment,reason:'invalid_bus'};
 if(slot.v!==1)return {status:'unrecognized',schema:fragment,reason:'unsupported_version'};
 try{
  if(!Array.isArray(slot.crit)||slot.crit.some(key=>!SLOT_KEYS.includes(key)))return {status:'unrecognized',schema:fragment,reason:'unsupported_critical_member'};
  if(Object.keys(slot).some(key=>!SLOT_KEYS.includes(key)))fail('invalid_bus');
  if(bytes(fragment)>16384||!slot.crit.includes('bus')||new Set(slot.crit).size!==slot.crit.length||slot.selection!=='exclusive'||Object.keys(fragment.fields).length!==1||typeof slot.field!=='string'||!own(fragment.fields,slot.field))fail('invalid_bus');
  const field=fragment.fields[slot.field],bus=slot.bus;if(field.type!=='resource'||field.cardinality?.min!==0||field.cardinality?.max!==1||field.contracts.length!==1||field.contracts[0]!==EVENT_BUS_CONTRACT)fail('invalid_bus');
  // Review M6: the field's own `consumers` (default applications) may admit no kind the slot excludes, so a bus whose
  // slot says ["provider"] is never application-requestable.
  subset(slot.consumers);if((field.consumers??['application']).some(kind=>!slot.consumers.includes(kind)))fail('invalid_bus');if(slot.options!==undefined){if(!object(slot.options)||Object.keys(slot.options).some(key=>!['occupant','consumer'].includes(key)))fail('invalid_bus');for(const fields of Object.values(slot.options))validateFields(fields,{allowEmpty:true,optionalTitle:true});}
  exact(bus,BUS_KEYS);
  if(bus.v!==1)fail('invalid_bus_version');strings(bus.types,32);if(!bus.types.length||bus.types.some(type=>!/^[a-z][a-z0-9.-]{0,47}$/.test(type)))fail('invalid_bus');
  payloadSchema(bus.payload);if(!integer(bus.max_record_bytes,64,16384))fail('invalid_bus');
  exact(bus.retention,['min_seconds','max_seconds']);if(!integer(bus.retention.max_seconds,1,2592000)||!integer(bus.retention.min_seconds,0,bus.retention.max_seconds))fail('invalid_bus');
  subset(bus.publishers);subset(bus.readers);if(bus.readers.some(kind=>!slot.consumers.includes(kind)))fail('invalid_bus');
  if(bus.history!==undefined&&!['never','owner-choice'].includes(bus.history))fail('invalid_bus');if(bus.categories!==undefined)strings(bus.categories);effects(bus.effects);
  return {status:'valid',schema:fragment,slot:structuredClone(slot),bus:structuredClone(bus)};
 }catch(error){if(!error.code)throw error;return {status:'invalid',schema:fragment,reason:error.code};}
}

// Same immutable namespace and trusted fetch boundary as fragments. No bus, resource, grant, route or capability
// declaration is created by a pin.
export async function pinBusManifest(options,url,expectedDigest){
 const versioned=await pinVersioned(options,url,'bus',(schema,id)=>{if(validateBusManifest(schema,id).status!=='valid')fail('unsupported_fragment');},expectedDigest);if(versioned)return {...versioned,digest:versioned.digest.startsWith('sha256-')?versioned.digest:'sha256-'+versioned.digest};
 if(expectedDigest!==undefined)validDigest(expectedDigest);
 if(!options.schemaHosts?.includes(https(url).host)||typeof options.schemaFetcher!=='function')fail('untrusted_schema_host');
 const schema=structuredClone(await options.schemaFetcher(url));if(validateBusManifest(schema,url).status!=='valid')fail('unsupported_fragment');
 const hash=await busDigest(options.crypto??globalThis.crypto,schema);if(expectedDigest!==undefined&&expectedDigest!==hash)fail('digest_mismatch');
 return options.store.transaction(async tx=>{const key=`federation/schema/${url}`,old=await tx.get(key);if(old&&old.digest!==hash.slice(7))fail('schema_changed','Immutable fragment changed; use a new URL.');const record={schema,digest:hash.slice(7)};if(!old)await tx.set(key,record);return {...record,digest:hash};});
}
export function createEventBusesProvider(options={}){return Object.freeze({validate:input=>validateBusManifest(input.schema,input.url??input.schema?.id),pin:input=>pinBusManifest(options,input.version===undefined?input.url:{artefact:input.url,version:input.version,digest:input.digest},input.digest)});}
function enabled(config){if(!siteGlobal(config,'EVENT_BUSES_ENABLED'))fail('event_buses_disabled');}
export class BusManifest extends AppQuery {static operation='events.manifest';static deps=['config','eventBuses'];fetch({config,eventBuses}){enabled(config);return eventBuses.validate(this.input);}}
export class PinBusManifest extends AppAction {static operation='events.pin';static deps=['config','eventBuses'];run({config,eventBuses}){enabled(config);return eventBuses.pin(this.input);}}
