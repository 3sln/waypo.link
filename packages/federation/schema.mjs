import {artefactURL} from '../core/artefacts.mjs';
import {objectKey} from '../storage/policy.mjs';
import { canonical, digest, boundedString } from '../core/records.mjs';
import {fragmentOutcome,fieldOutcome,FIELD_NAME} from '../core/fragments.mjs';
import {validateBusManifest} from './event-buses.mjs';
export class FederationFault extends Error { constructor(code,message=code){super(message);this.name='FederationFault';this.code=code;} }
export const fail=(code,message)=>{throw new FederationFault(code,message);};
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function exact(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('invalid_args','Unexpected fields.');}
export function https(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href!==value&&url.origin!==value)fail('invalid_args','Canonical HTTPS URL required.');return url;}catch{fail('invalid_args','Canonical HTTPS URL required.');}}
export function strings(value,max=64){if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length||value.some(x=>!boundedString(x,2048)))fail('invalid_args','Bounded distinct strings required.');return value;}
/** Fragment documents against the exhaustive protocol §3 member table (packages/core/fragments.mjs; extensions rev 3.2,
 * CR-X3-30). An unknown member anywhere (including a top-level `slot`) is `unsupported_fragment`; a listed member used
 * wrongly is `invalid_schema`. Never partial semantics. */
export function validateSchema(schema,url){
  https(url);const outcome=fragmentOutcome(schema,url);
  // Interim (pending events CR-X3-09): a legacy event-bus manifest keeps its `slot` container, which the events
  // implementation validates whole; this provider implements it, so the bus member counts here (the extension-
  // conditional rule of protocol §3). Any other top-level `slot` stays unsupported.
  if(outcome.status==='unsupported'&&outcome.reason==='slot_member'&&validateBusManifest(schema,url).status==='valid')return structuredClone(schema);
  if(outcome.status==='unsupported')fail('unsupported_fragment','This fragment uses members this provider does not support.');
  if(outcome.status!=='valid')fail('invalid_schema');return structuredClone(schema);
}
/** A set of fields against the member table (resource attributes included). */
export function validateFields(fields,{allowEmpty=false,optionalTitle=false}={}){
  if(!object(fields)||!allowEmpty&&!Object.keys(fields).length||Object.keys(fields).length>32)fail('invalid_schema');
  for(const [name,field] of Object.entries(fields)){if(!FIELD_NAME.test(name))fail('invalid_schema');const outcome=fieldOutcome(field,{optionalTitle});if(outcome.status==='unsupported')fail('unsupported_fragment');if(outcome.status!=='valid')fail('invalid_schema');}
  return structuredClone(fields);
}
export function validateValue(field,value,validateURL=https){
  const {min,max}=field.cardinality??{min:1,max:1};const values=max===1?[value]:value;if(!Array.isArray(values)||values.length<min||values.length>max)fail('invalid_preferences');
  for(const item of values){const type=field.type;
    if(type==='url')validateURL(item);if(type==='resource'){if(object(item)){exact(item,['resource','scope']);validateURL(item.resource);if(!object(item.scope))fail('invalid_preferences');exact(item.scope,['prefix','readOnly','maxObjectBytes']);if(item.scope.prefix!==undefined&&(typeof item.scope.prefix!=='string'||item.scope.prefix.length>1024||item.scope.prefix.startsWith('/')||item.scope.prefix.includes('\\')||item.scope.prefix.includes('//')||item.scope.prefix.split('/').some(part=>part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(item.scope.prefix)))fail('invalid_preferences');if(item.scope.prefix){try{objectKey(item.scope.prefix.replace(/\/$/,''));}catch{fail('invalid_preferences');}}if(item.scope.readOnly!==undefined&&typeof item.scope.readOnly!=='boolean'||item.scope.maxObjectBytes!==undefined&&(!Number.isSafeInteger(item.scope.maxObjectBytes)||item.scope.maxObjectBytes<1||item.scope.maxObjectBytes>1048576))fail('invalid_preferences');}else validateURL(item);}
    if(type==='string'||type==='url'){if(typeof item!=='string'||item.length<(field.minLength??0)||item.length>field.maxLength||/[\u0000-\u001f\u007f]/.test(item))fail('invalid_preferences');}
    if(type==='boolean'&&typeof item!=='boolean'||type==='enum'&&!field.values.includes(item))fail('invalid_preferences');
    if(['integer','number'].includes(type)&&(!Number.isFinite(item)||Math.abs(item)>Number.MAX_SAFE_INTEGER||item<field.minimum||item>field.maximum||type==='integer'&&!Number.isSafeInteger(item)))fail('invalid_preferences');
  }
  if(typeResource(field)&&new Set(values.map(value=>object(value)?value.resource:value)).size!==values.length)fail('invalid_preferences');return values;
}
const typeResource=field=>field.type==='resource';
// The fetcher carries the adapter-owned engine port; existing service constructors keep their API.
export async function pinVersioned({store,schemaFetcher,schemaHosts,crypto=globalThis.crypto},target,kind,validate,expectedDigest){
  const explicit=object(target),url=explicit?(target.artefact??target.fragment??target.slot??target.manifest??target.url):target,port=schemaFetcher?.artefacts;
  if(!port?.enabled){if(explicit)fail('unsupported_artefact_version');return null;}
  const host=https(url).host;if(!schemaHosts?.includes(host))fail('untrusted_schema_host');
  try{artefactURL(url);}catch(error){if(!explicit)return null;throw error;}
  const old=!explicit&&expectedDigest===undefined?await store.transaction(tx=>tx.get(`federation/schema/${url}`)):null;
  if(old&&await digest(crypto,canonical(old.schema))!==(old.digest?.startsWith('sha256-')?old.digest.slice(7):old.digest))fail('artefact_digest_mismatch');
  const reference={artefact:url,...explicit&&target.version!==undefined?{version:target.version}:{},...explicit&&target.digest!==undefined?{digest:target.digest}:expectedDigest!==undefined?{digest:expectedDigest}:old?{digest:old.digest}:{}};
  const pin=await port.pin({...reference,kind});validate(pin.body,url);
  if(pin.legacy)await store.transaction(async tx=>{const key=`federation/schema/${url}`,prior=await tx.get(key),bare=pin.reference.digest.slice(7);if(prior&&(prior.digest?.startsWith('sha256-')?prior.digest.slice(7):prior.digest)!==bare)fail('schema_changed','Immutable fragment changed; use a new URL.');if(!prior)await tx.set(key,{schema:pin.body,digest:bare});});
  return {schema:pin.body,digest:pin.legacy?pin.reference.digest.slice(7):pin.reference.digest,...pin.reference.version?{version:pin.reference.version}:{},reference:pin.reference};
}
export async function pinSchema(options,url){
  const versioned=await pinVersioned(options,url,undefined,validateSchema);if(versioned)return versioned;
  const {store,crypto,schemaFetcher,schemaHosts}=options;
  const host=https(url).host;if(!schemaHosts.includes(host)||typeof schemaFetcher!=='function')fail('untrusted_schema_host');
  // The fetcher is a trusted runtime capability: it must reject redirects and
  // private-address DNS results before making a request. No ambient fetch here.
  const schema=await schemaFetcher(url);const encoded=canonical(schema);if(new TextEncoder().encode(encoded).length>65536)fail('invalid_schema');validateSchema(schema,url);const hash=await digest(crypto,encoded);
  return store.transaction(async tx=>{const old=await tx.get(`federation/schema/${url}`);if(old&&old.digest!==hash)fail('schema_changed','Immutable fragment changed; use a new URL.');const record={schema,digest:hash};if(!old)await tx.set(`federation/schema/${url}`,record);return record;});
}
