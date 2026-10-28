// Extensions revision 3.2 (docs/spec/extensions.md; draft, unsigned) — engine operations over the pure core modules.
// Revision 2 (slots, slot manifests, `crit`, `supersedes`, occupant/consumer declarations, AMD-X1 `bind`) is removed:
// a fragment's resource fields carry the core attributes `selection`, `consumers` and `announce` instead
// (packages/core/fragments.mjs), and declarations are `{spec, options}` (packages/core/extensions.mjs).
//
// This module holds the selection state machine (extensions §3): a pure function of the field and the consumer's
// current projection. The adapter supplies availability (projection status, credential currency and, for a provider
// feature, a live and unsuspended enablement); nothing here mints a token or reaches an endpoint.
import {siteGlobal} from '../flags/read.mjs';
import {AppQuery} from '../app/engine.mjs';
import {fail,object} from './schema.mjs';
import {fieldOutcome,cardinalityOf,consumes} from '../core/fragments.mjs';
import {readExtensions,BINDLE_REGISTRY,descriptorRegistry,BINDLE_DESCRIPTORS,PROVIDER_DESCRIPTORS} from '../core/extensions.mjs';

/** Every descriptor this provider implements: the Bindle-owned ones plus its own provider-feature extensions. */
export const PROVIDER_REGISTRY=descriptorRegistry([...BINDLE_DESCRIPTORS,...PROVIDER_DESCRIPTORS]);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
/** Outcomes that prove no effect occurred (extensions §3.3, protocol §5 AMD-C4). */
export const NO_EFFECT_CODES=Object.freeze(['unsupported_contract','unsupported_method','forbidden','not_found','rate_limited','temporarily_unavailable']);
export const NO_EFFECT_STATUS=Object.freeze([401,403,404,429]);

/**
 * One operation over a resource field (extensions §3.2: the value is read once per operation). `resources` is the
 * consumer's current projection in owner order: [{id, status, credentialCurrent}] (an `exclusive` field may pass a
 * single object or undefined). `consumer`: 'application' | 'provider'; `featureLive`: the provider feature's enablement
 * is live and not suspended (extensions §3.1). A field without `selection` has no failover guarantee: it is treated
 * like `exclusive` over the first resource, which is the only safe reading.
 */
export function createFieldOperation(field,resources,{consumer='application',featureLive=false}={}){
 if(fieldOutcome(field).status!=='valid'||field.type!=='resource')fail('invalid_field');
 if(!consumes(field,consumer))fail('unsupported_consumer');
 const max=cardinalityOf(field).max,list=resources===undefined?[]:Array.isArray(resources)?resources:[resources];
 if(list.length>max||list.some(value=>!object(value)||typeof value.id!=='string')||new Set(list.map(value=>value.id)).size!==list.length)fail('invalid_resources');
 return {selection:field.selection??null,consumer,featureLive:featureLive===true,resources:structuredClone(list),attempts:[],outcomes:[],stopped:false};
}
const available=(state,resource)=>resource.status==='available'&&resource.credentialCurrent===true&&(state.consumer!=='provider'||state.featureLive);
/** The next dispatch, or null. Every dispatch needs a fresh caller-supplied tx (journals are per resource server);
 * retrying an unknown outcome reuses the earlier attempt's tx with the same resource, never another resource. */
export function nextFieldDispatch(operation,{tx,removed=[],featureLive=operation.featureLive}={}){
 const state=structuredClone(operation);state.featureLive=featureLive===true;
 for(const id of removed){const resource=state.resources.find(value=>value.id===id);if(resource)resource.status='unavailable';const attempt=state.attempts.find(value=>value.id===id),outcome=attempt&&state.outcomes.find(value=>value.tx===attempt.tx);if(attempt&&(!outcome||outcome.status==='unknown')){if(!outcome)state.outcomes.push({...attempt,status:'unknown'});state.stopped=true;}}
 if(state.stopped||state.consumer==='provider'&&!state.featureLive||state.attempts.some(value=>!state.outcomes.some(outcome=>outcome.tx===value.tx)))return {state,dispatch:null};
 const candidates=state.resources.filter(value=>available(state,value)&&!state.attempts.some(attempt=>attempt.id===value.id));
 // Only `ordered` ever advances; `exclusive` and a field without a policy invoke the first resource only.
 const resource=state.selection==='ordered'?candidates[0]:state.attempts.length?null:state.resources[0]&&available(state,state.resources[0])?state.resources[0]:null;
 if(!resource)return {state,dispatch:null};if(!uuid(tx)||state.attempts.some(value=>value.tx===tx))fail('invalid_tx');
 state.attempts.push({id:resource.id,tx});return {state,dispatch:{resource:structuredClone(resource),tx}};
}
/** Records an attempt's outcome. `ordered` advances only after a proven no-effect failure (extensions §3.3). A 5xx is
 * ambiguous whatever error code it carries (review L9): it never switches resources. */
export function recordFieldOutcome(operation,{tx,ok=false,httpStatus,code,bytesSent}={}){
 const state=structuredClone(operation),attempt=state.attempts.find(value=>value.tx===tx);if(!attempt||state.outcomes.some(value=>value.tx===tx))fail('invalid_outcome');
 const ambiguous=Number.isSafeInteger(httpStatus)&&httpStatus>=500,noEffect=bytesSent===false||!ambiguous&&(NO_EFFECT_STATUS.includes(httpStatus)||NO_EFFECT_CODES.includes(code)),status=ok===true?'succeeded':noEffect?'failed':'unknown';
 state.outcomes.push({...attempt,status});
 if(state.selection!=='ordered'||status!=='failed')state.stopped=true;
 return state;
}
/** Per-resource and overall status: unfilled, unavailable, pending, succeeded, failed or unknown. */
export function fieldOperationResult(state){
 const outcomes=state.resources.map(resource=>({id:resource.id,status:state.outcomes.find(value=>value.id===resource.id)?.status??(state.attempts.some(value=>value.id===resource.id)?'pending':!available(state,resource)?'unavailable':state.stopped||state.selection!=='ordered'&&state.attempts.length?'not_selected':'pending')}));
 const statuses=outcomes.filter(value=>!['unavailable','not_selected'].includes(value.status)).map(value=>value.status);
 const status=statuses.includes('pending')?'pending':statuses.includes('unknown')?'unknown':statuses.includes('succeeded')?'succeeded':statuses.length?'failed':state.resources.length?'unavailable':'unfilled';
 return {status,outcomes};
}

// Unmounted edge operations, gated by EXTENSIONS_ENABLED. Adapters bind this provider explicitly; config alone never
// advertises support.
export function createExtensionsProvider({registry=PROVIDER_REGISTRY}={}){return Object.freeze({
 declarations:input=>{const result=readExtensions(input?.manifest,{registry,issuer:input?.manifest?.issuer});return {extensions:Object.fromEntries(result.extensions),absent:result.absent,ignored:result.ignored};},
 field:input=>fieldOutcome(input?.field),
 selection:input=>createFieldOperation(input?.field,input?.resources,{consumer:input?.consumer,featureLive:input?.featureLive}),
});}
function enabled(config){if(!siteGlobal(config,'EXTENSIONS_ENABLED'))fail('extensions_disabled');}
export class ExtensionDeclarations extends AppQuery {static operation='extensions.declarations';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.declarations(this.input);}}
export class FieldAttributes extends AppQuery {static operation='extensions.field';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.field(this.input);}}
export class FieldSelection extends AppQuery {static operation='extensions.selection';static deps=['config','extensions'];fetch({config,extensions}){enabled(config);return extensions.selection(this.input);}}
export {BINDLE_REGISTRY};
