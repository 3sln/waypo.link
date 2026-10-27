import {siteGlobal} from '../flags/read.mjs';
import {AppAction,AppQuery} from '../app/engine.mjs';
import {canonical,digest,boundedString} from '../messaging/store.mjs';
import {fail,object,https,strings,pinVersioned,validateSchema,validateFields,validateValue} from './schema.mjs';

// `bind` is AMD-X1 (bound consumer options; docs/spec/extensions.md §2.1, proposed and unsigned). A processor built
// without it (`boundOptions:false`) does not understand `bind`, so a slot listing it in `crit` is unrecognized there.
const SLOT_KEYS=['v','crit','field','selection','failover','consumers','options','supersedes','bind'],POLICIES=['exclusive','ordered','broadcast','consumer-choice'];
const own=(value,key)=>object(value)&&Object.hasOwn(value,key),bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const slotURL=value=>{if(typeof value!=='string'||value.length>256)fail('invalid_slot');const url=https(value);if(value.includes('?')||value.includes('#'))fail('invalid_slot');return url;};
export function validateExtensionDigest(value){if(typeof value!=='string'||!/^sha256-[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value))fail('invalid_digest');return value;}
export const slotDigest=async(crypto,schema)=>'sha256-'+await digest(crypto,canonical(schema));
// Contracts are exact-URL pinned records supplied by a trusted provider, never publisher assertions.
export function harmlessSlot(schema,contracts={}){
 const field=schema.fields?.[schema.slot?.field];if(!field?.contracts?.length)return false;
 return field.contracts.every(id=>{const pin=contracts instanceof Map?contracts.get(id):own(contracts,id)?contracts[id]:null,document=pin?.schema,methods=document?.['x-methods'];return typeof pin?.digest==='string'&&!!pin.digest&&document?.$id===id&&object(methods)&&Object.keys(methods).length>0&&Object.values(methods).every(method=>object(method)&&['read','pure'].includes(method.effect));});
}
// An invalid/unrecognized slot remains a valid ordinary fragment (AMD-C1). Never return partial semantics.
export function validateSlotManifest(schema,url=schema?.id,{contracts={},boundOptions=true}={}){
 const fragment=validateSchema(schema,url);if(!own(fragment,'slot'))return {status:'absent',schema:fragment};
 const slot=fragment.slot;if(!object(slot))return {status:'invalid',schema:fragment,reason:'invalid_slot'};
 if(slot.v!==1)return {status:'unrecognized',schema:fragment,reason:'unsupported_version'};
 try{
  if(slot.crit!==undefined){strings(slot.crit,32);if(slot.crit.some(key=>!SLOT_KEYS.includes(key)||key==='bind'&&!boundOptions))return {status:'unrecognized',schema:fragment,reason:'unsupported_critical_member'};if(slot.crit.some(key=>!own(slot,key)))fail('invalid_slot');}
  if(bytes(fragment)>16384)fail('invalid_slot');
  if(typeof slot.field!=='string'||!own(fragment.fields,slot.field)||!POLICIES.includes(slot.selection))fail('invalid_slot');
  const field=fragment.fields[slot.field],cardinality=field.cardinality;
  if(field.type!=='resource'||Object.values(fragment.fields).filter(field=>field.type==='resource').length!==1||cardinality?.min!==0||!Number.isSafeInteger(cardinality.max)||cardinality.max<1||cardinality.max>8||(slot.selection==='exclusive'?cardinality.max!==1:cardinality.max<2))fail('invalid_slot');
  if(slot.failover!==undefined&&(slot.selection!=='ordered'||!['pre-dispatch','any-error'].includes(slot.failover)))fail('invalid_slot');
  strings(slot.consumers,2);if(!slot.consumers.length||slot.consumers.some(value=>!['application','provider'].includes(value)))fail('invalid_slot');
  if(slot.options!==undefined){if(!object(slot.options)||Object.keys(slot.options).some(key=>!['occupant','consumer'].includes(key)))fail('invalid_slot');for(const fields of Object.values(slot.options))validateFields(fields,{allowEmpty:true,optionalTitle:true});}
  // AMD-X1 item 1: `bind` names options.consumer members, and a slot using it MUST list it in `crit`.
  if(slot.bind!==undefined){strings(slot.bind,16);if(!slot.bind.length||!slot.crit?.includes('bind')||slot.bind.some(name=>!own(slot.options?.consumer,name)))fail('invalid_slot');}
  if(slot.supersedes!==undefined&&slot.supersedes!==null&&(https(slot.supersedes).origin!==new URL(url).origin||slot.supersedes===url))fail('invalid_slot');
  const harmless=harmlessSlot(fragment,contracts);if(slot.failover==='any-error'&&!harmless)fail('unsafe_failover');
  return {status:'valid',schema:fragment,slot:structuredClone(slot),harmless};
 }catch(error){if(!error.code)throw error;return {status:'invalid',schema:fragment,reason:error.code};}
}

function declarationOptions(entry,slot){
 const schema=slot.options?.[entry.role]??{},options=entry.options??{};
 if(!object(options)||Object.keys(options).some(key=>!own(schema,key)))fail('invalid_options');
 for(const [name,field] of Object.entries(schema)){if(!own(options,name)){if((field.cardinality?.min??1)>0)fail('invalid_options');}else validateValue(field,options[name]);}
}
// Syntax first; unfetched documents stay unknown. This function performs no I/O and never merges issuers.
// slots: Map<exact URL,{schema,digest}>; accepts raw ordinary-fragment pins or prefixed wire digests.
export function validateExtensions(entries,{kind='provider',slots=new Map(),contracts={}}={}){
 if(!['provider','integration'].includes(kind))fail('invalid_args');
 if(entries===undefined)return [];if(!Array.isArray(entries)||entries.length>32)return [];
 const triples=new Map(),counts=new Map();
 for(const entry of entries)if(object(entry)&&typeof entry.slot==='string'){
  counts.set(entry.slot,(counts.get(entry.slot)??0)+1);
  if(typeof entry.role==='string'&&typeof entry.ref==='string'){const key=JSON.stringify([entry.slot,entry.role,entry.ref]);triples.set(key,(triples.get(key)??0)+1);}
 }
 return entries.map(entry=>{
  try{
   if(!object(entry)||bytes(entry)>2048)fail('invalid_extension');slotURL(entry.slot);
   if(!['occupant','consumer'].includes(entry.role)||typeof entry.ref!=='string'||! /^[a-z][a-z0-9-]{0,31}$/.test(entry.ref)||counts.get(entry.slot)>4||triples.get(JSON.stringify([entry.slot,entry.role,entry.ref]))>1)fail('invalid_extension');
   if(entry.digest!==undefined)validateExtensionDigest(entry.digest);
   if(entry.purpose!==undefined&&(entry.role!=='consumer'||!boundedString(entry.purpose,200)))fail('invalid_extension');
   if(entry.required!==undefined&&(kind!=='integration'||entry.role!=='consumer'||typeof entry.required!=='boolean'))fail('invalid_extension');
   if(entry.options!==undefined&&!object(entry.options))fail('invalid_options');
   const clean=Object.fromEntries(['slot','digest','role','ref','purpose','required','options'].filter(key=>own(entry,key)).map(key=>[key,structuredClone(entry[key])]));
   const pin=slots instanceof Map?slots.get(entry.slot):own(slots,entry.slot)?slots[entry.slot]:null;
   if(!pin)return {status:'unknown',entry:clean};
   if(entry.digest!==undefined&&entry.digest!==(pin.digest?.startsWith('sha256-')?pin.digest:'sha256-'+pin.digest))fail('digest_mismatch');
   const result=validateSlotManifest(pin.schema,entry.slot,{contracts});if(result.status!=='valid')fail('unsupported_slot');
   if(entry.role==='consumer'&&!result.slot.consumers.includes(kind==='provider'?'provider':'application'))fail('unsupported_consumer');
   declarationOptions(clean,result.slot);return {status:'valid',entry:clean};
  }catch(error){if(!error.code)throw error;return {status:'invalid',reason:error.code};}
 });
}

// Approval/enablement capability only. The fetcher must enforce SSRF/redirect/time/size budgets.
// Shares the ordinary fragment pin namespace and raw digest format; no grant or occupancy is created.
export async function pinSlotManifest(options,url,expectedDigest){
 const {store,crypto,schemaFetcher,schemaHosts,contracts={}}=options;
 const versioned=await pinVersioned(options,url,'slot',(schema,id)=>{if(validateSlotManifest(schema,id,{contracts}).status!=='valid')fail('unsupported_fragment');},expectedDigest);if(versioned)return {...versioned,digest:versioned.digest.startsWith('sha256-')?versioned.digest:'sha256-'+versioned.digest};
 https(url);if(expectedDigest!==undefined)validateExtensionDigest(expectedDigest);
 if(!schemaHosts?.includes(new URL(url).host)||typeof schemaFetcher!=='function')fail('untrusted_schema_host');
 const schema=structuredClone(await schemaFetcher(url)),result=validateSlotManifest(schema,url,{contracts});if(result.status!=='valid')fail('unsupported_fragment');
 const hash=await slotDigest(crypto,schema);if(expectedDigest!==undefined&&expectedDigest!==hash)fail('digest_mismatch');
 return store.transaction(async tx=>{const key=`federation/schema/${url}`,old=await tx.get(key);if(old&&old.digest!==hash.slice(7))fail('schema_changed','Immutable fragment changed; use a new URL.');const record={schema,digest:hash.slice(7)};if(!old)await tx.set(key,record);return {...record,digest:hash};});
}

// Selection is a pure state machine. Input occupants come ONLY from the current approved projection;
// the adapter supplies credentialCurrent and live provider enablement. No token or endpoint is minted here.
export function createSlotOperation(schema,occupants,{contracts={},consumer='application',featureEnabled=false}={}){
 const result=validateSlotManifest(schema,schema?.id,{contracts});if(result.status!=='valid')fail('unsupported_slot');
 if(!result.slot.consumers.includes(consumer))fail('unsupported_consumer');
 const max=schema.fields[result.slot.field].cardinality.max,list=occupants===undefined?[]:max===1?[occupants]:occupants;
 if(!Array.isArray(list)||list.length>max||list.some(value=>!object(value)||typeof value.id!=='string')||new Set(list.map(value=>value.id)).size!==list.length)fail('invalid_occupants');
 const state={selection:result.slot.selection,failover:result.slot.failover??'pre-dispatch',harmless:result.harmless,consumer,featureEnabled:featureEnabled===true,occupants:structuredClone(list),attempts:[],outcomes:[],stopped:false};
 return state;
}
const available=(state,occupant)=>occupant.status==='available'&&occupant.credentialCurrent===true&&(state.consumer!=='provider'||state.featureEnabled);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
// Every dispatch needs a fresh caller-supplied tx; retrying an unknown outcome reuses the returned attempt.
export function nextSlotDispatch(operation,{tx,choice,removed=[],featureEnabled=operation.featureEnabled}={}){
 const state=structuredClone(operation);state.featureEnabled=featureEnabled===true;
 for(const id of removed){const occupant=state.occupants.find(value=>value.id===id);if(occupant)occupant.status='unavailable';const attempt=state.attempts.find(value=>value.id===id),outcome=attempt&&state.outcomes.find(value=>value.tx===attempt.tx);if(attempt&&(!outcome||outcome.status==='unknown')){if(!outcome)state.outcomes.push({...attempt,status:'unknown'});if(state.selection!=='broadcast')state.stopped=true;}}
 if(state.stopped||state.consumer==='provider'&&!state.featureEnabled||state.selection!=='broadcast'&&state.attempts.some(value=>!state.outcomes.some(outcome=>outcome.tx===value.tx)))return {state,dispatch:null};
 const candidates=state.occupants.filter(value=>available(state,value)&&!state.attempts.some(attempt=>attempt.id===value.id));
 let occupant;if(state.selection==='consumer-choice'){if(choice===undefined)return {state,dispatch:null};occupant=candidates.find(value=>value.id===choice);if(!occupant)fail('invalid_choice');if(state.attempts.length&&!state.harmless)fail('unsafe_selection');}else occupant=candidates[0];
 if(!occupant)return {state,dispatch:null};if(!uuid(tx)||state.attempts.some(value=>value.tx===tx))fail('invalid_tx');
 const dispatch={occupant:structuredClone(occupant),tx};state.attempts.push({id:occupant.id,tx});return {state,dispatch};
}
const NO_EFFECT_CODES=['unsupported_contract','unsupported_method','forbidden','not_found','rate_limited','temporarily_unavailable'];
export function recordSlotOutcome(operation,{tx,ok=false,httpStatus,code,bytesSent}={}){
 const state=structuredClone(operation),attempt=state.attempts.find(value=>value.tx===tx);if(!attempt||state.outcomes.some(value=>value.tx===tx))fail('invalid_outcome');
 const noEffect=bytesSent===false||[401,403,404,429].includes(httpStatus)||NO_EFFECT_CODES.includes(code),status=ok===true?'succeeded':noEffect?'failed':'unknown';
 state.outcomes.push({...attempt,status});
 if(state.selection==='exclusive'||state.selection==='ordered'&&(status==='succeeded'||!noEffect&&state.failover!=='any-error')||state.selection==='consumer-choice'&&!state.harmless)state.stopped=true;
 return state;
}
export function slotOperationResult(state){
 const outcomes=state.occupants.map(occupant=>({id:occupant.id,status:state.outcomes.find(value=>value.id===occupant.id)?.status??(state.attempts.some(value=>value.id===occupant.id)?'pending':!available(state,occupant)?'unavailable':state.stopped||state.selection==='consumer-choice'&&state.attempts.length?'not_selected':'pending')}));
 const statuses=outcomes.filter(value=>!['unavailable','not_selected'].includes(value.status)).map(value=>value.status);
 const status=statuses.includes('pending')?'pending':statuses.includes('unknown')?'unknown':statuses.includes('succeeded')?(state.selection==='broadcast'&&statuses.includes('failed')?'partial':'succeeded'):statuses.length?'failed':state.occupants.length?'unavailable':'unfilled';
 return {status,outcomes};
}

// ---- AMD-X1 bound consumer options (docs/spec/extensions.md §2.1 `bind`, §5.2; proposed, unsigned) ---------------
// A request for a slot fragment whose slot has `bind` carries `options`; the owner approves a subset at consent; the
// approval is recorded per consumer in its grant and never shared with other consumers of the slot field; the
// occupant enforces it on every invocation. Values are normalized to lists. Pure functions; the federation service
// owns the records (packages/federation/service.mjs).
/** The valid slot member of `schema` when it binds consumer options under AMD-X1, else null. */
export function boundSlot(schema,url=schema?.id,{boundOptions=true}={}){if(!boundOptions)return null;let result;try{result=validateSlotManifest(schema,url,{boundOptions});}catch{return null;}return result.status==='valid'&&result.slot.bind?result.slot:null;}
const boundField=(slot,name)=>slot.options.consumer[name],asValues=(field,value)=>(field.cardinality?.max??1)===1?[value]:value;
const boundValue=(field,values)=>(field.cardinality?.max??1)===1?values[0]:values;
/** The bound member schemas, kept with an approval so it can be revalidated without the slot document. */
export const boundSchema=slot=>Object.fromEntries(slot.bind.map(name=>[name,structuredClone(boundField(slot,name))]));
function boundValues(schema,options,code){
 if(!object(options)||Object.keys(options).some(key=>!own(schema,key)))fail(code);const out={};
 for(const [name,field] of Object.entries(schema)){if(!own(options,name))fail(code);try{validateValue(field,options[name]);}catch{fail(code);}const list=asValues(field,options[name]);if(new Set(list).size!==list.length)fail(code);out[name]=[...list];}
 return out;
}
/** AMD-X1 item 2: the request's `options`, validated against the bound `options.consumer` members. Only bound members
 * may be carried (unbound consumer options confer nothing); every bound member is required. Returns lists. */
export const validateBoundRequest=(slot,options)=>boundValues(boundSchema(slot),options,'invalid_request');
/** AMD-X1 item 3: the owner's approved values, a subset of the requested ones that still satisfies each member's schema
 * (the owner declines the fragment rather than approving fewer than the minimum). */
export function approveBoundOptions(schema,requested,approved){
 const out=boundValues(schema,Object.fromEntries(Object.entries(approved??{}).map(([name,values])=>[name,own(schema,name)&&Array.isArray(values)?boundValue(schema[name],values):values])),'invalid_grant');
 for(const [name,values] of Object.entries(out))if(values.some(value=>!requested[name]?.includes(value)))fail('invalid_grant');
 return out;
}
/** True when every requested value is within the approved values (a request beyond them is a widening). */
export const boundCovers=(approved,requested)=>Object.entries(requested??{}).every(([name,values])=>Array.isArray(approved?.[name])&&values.every(value=>approved[name].includes(value)));
/** Owner narrowing (immediate): the next values must validate and stay within the current ones; widening refused. */
export function narrowBoundOptions(schema,current,next){
 const out=boundValues(schema,Object.fromEntries(Object.entries(next??{}).map(([name,values])=>[name,own(schema,name)&&Array.isArray(values)?boundValue(schema[name],values):values])),'invalid_args');
 if(!boundCovers(current,out))fail('bound_options_widening','Widening approved options needs a new approval.');return out;
}
/**
 * Whether a version of a bound artefact line is usable under an approval that recorded `approved` ({version, digest})
 * at consent: the exact approved version always; a later version only when `verify(approved, reference)` reports the
 * step verified additive and not widening (artefacts §7.2; a widening needs a new approval). Without a signed growth
 * table nobody can verify, so only the approved version is usable (spec rtc-signaling §3.5 item 3).
 */
export function boundVersionUsable(approved,reference,{verify}={}){
 if(!approved||!reference)return false;if(reference.version===approved.version)return reference.digest===approved.digest;
 return reference.version>approved.version&&typeof verify==='function'&&verify(approved,reference)==='additive';
}
/** AMD-X1 item 4, the occupant check: `value` is approved for `member` in this consumer's bound approval and, for an
 * artefact line, `reference` is usable under one of the recorded versions. `approval` is {values, versions}, where
 * versions[line] is one {version, digest} or a list of them. */
export function boundAllows(approval,member,value,{reference,verify}={}){
 if(!approval||!Array.isArray(approval.values?.[member])||!approval.values[member].includes(value))return false;
 const recorded=approval.versions?.[value],list=recorded===undefined?[]:Array.isArray(recorded)?recorded:[recorded];
 return list.length?list.some(approved=>boundVersionUsable(approved,reference,{verify})):reference===undefined;
}

// Unmounted edge operations. Future adapters bind this provider explicitly; config alone never advertises support.
export function createExtensionsProvider(options={}){return Object.freeze({validateSlot:input=>validateSlotManifest(input.schema,input.url??input.schema?.id,{contracts:options.contracts}),declarations:input=>validateExtensions(input.entries,{kind:input.kind,slots:options.slots,contracts:options.contracts}),selection:input=>createSlotOperation(input.schema,input.occupants,{contracts:options.contracts,consumer:input.consumer,featureEnabled:input.featureEnabled}),pin:input=>pinSlotManifest(options,input.version===undefined?input.url:{artefact:input.url,version:input.version,digest:input.digest},input.digest)});}
function enabled(config){if(!siteGlobal(config,'EXTENSIONS_ENABLED'))fail('extensions_disabled');}
export class SlotManifest extends AppQuery {static operation='extensions.slot';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.validateSlot(this.input);}}
export class ExtensionDeclarations extends AppQuery {static operation='extensions.declarations';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.declarations(this.input);}}
export class SlotSelection extends AppQuery {static operation='extensions.selection';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.selection(this.input);}}
export class PinSlotManifest extends AppAction {static operation='extensions.pin';static deps=['config','extensions'];run({config,extensions}){enabled(config);return extensions.pin(this.input);}}
