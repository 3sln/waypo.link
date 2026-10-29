import {ownerFlags} from './flags.mjs';
// Extensions CR-X3-25 (provisional, unsigned): the 3sln.me built-in classifier, a resource in the owner's pool that
// implements the Bindle item-classification/v1 contract (docs/spec/extensions/item-classification.md), listed in the
// provider manifest's `contracts` (extensions §5.2) while it is offered. Owner direction 2026-10-28: paid tiers get it,
// running on 3sln.me's own Workers AI account; free accounts get none; it is highly rate limited, with limits that scale
// by plan (paid < plus < ultra) because every call costs 3sln.me real money. The owner's own Cloudflare account (a later
// integration) is separate.
//
// Text only, honestly declared through `capabilities`. The caller supplies the taxonomy with every call; nothing here
// hard-codes categories. Apps consume it through an ordinary grant on the shared item-classification fragment, whose
// values only the owner sets; there is no slot, automatic assignment, threshold or model fallback.
//
// Order of a `classify` call: validate and check capabilities (invalid_args, unsupported_item) -> configuration -> paid
// gate (forbidden) -> the shared AI allowance (account month, 50% app share, minute cap) in one transaction (rate_limited with Retry-After;
// counters only) -> covered work admission -> FIRST EFFECT: the spend lease on the shared `ai` ledger -> model ->
// entitlement recheck. A refused admission or lease credits the allowance debit back (review M1). Everything from the lease on runs under afterEffect: a refusal there is `indeterminate`, never a
// no-effect code (review M2). Nothing content-bearing is written anywhere; the federation journal keeps no result and
// fingerprints non-retained requests with a per-owner key (review L3).
import fragment from '../../../docs/artefacts/fragments/item-classification-v1.json' with {type:'json'};
import contract from '../../../docs/artefacts/item-classification-v1.json' with {type:'json'};
import {AppAction,AppQuery,createAppEngine,perform,read,operations} from '../../app/engine.mjs';
import {AppFault} from '../../app/faults.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {SemanticBudgetError} from '../semantic-budget.mjs';
import {SEMANTIC_LAYOUT,semanticShard} from '../semantic-routing.mjs';
import {validateClassifyArgs,validateCapabilitiesArgs,validateCapabilities,refuseUnsupported,afterEffect} from '../../sdk/src/item-classification.mjs';
import {AI_PLANS,aiLimits,reserveAIAllowance,releaseAIAllowance,retryAfter} from '../ai-allowance.mjs';
import {CLASSIFIER_LIMITS,CLASSIFIER_MODEL,CLASSIFIER_COST,classifierCostMicroUSD,workersAIClassifierModel} from './classifier-models.mjs';
export {CLASSIFIER_LIMITS,CLASSIFIER_MODEL,CLASSIFIER_COST,classifierCostMicroUSD};

const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const CLASSIFIER_FRAGMENT_DOCUMENT=freeze(structuredClone(fragment)),CLASSIFIER_FRAGMENT=fragment.id,CLASSIFIER_CONTRACT_DOCUMENT=freeze(structuredClone(contract)),CLASSIFIER_CONTRACT=contract.$id;
export const CLASSIFIER_METHODS=Object.freeze(['capabilities','classify']),CLASSIFIER_LABEL='3sln.me classifier';
/**
 * Plan limits of the classifier, a view of the shared AI allowance (packages/runtime/ai-allowance.mjs; coordinator plan
 * 2026-10-28, pending owner sign-off): the account's monthly AI spend shared with future AI services, this app's 50%
 * share of it, and the classifier's own per-minute call cap. A plan that is not listed (free) gets no classifier at all.
 * The service-wide `ai` ledger (AI_GLOBAL_*, owner share) stays a backstop across all accounts; it must be sized for the
 * plan table before the classifier is offered.
 */
export const CLASSIFIER_PLAN_LIMITS=freeze(Object.fromEntries(AI_PLANS.map(plan=>[plan,aiLimits(plan,'classify')]).filter(([,limits])=>limits)));
export const CLASSIFIER_PLANS=Object.freeze(Object.keys(CLASSIFIER_PLAN_LIMITS));
/** The built-in classifier resource of `owner` (one per account, stable). */
export const classifierResource=(config,owner)=>`${config.APP_ORIGIN}/entities/${owner}/classifier`;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** The model port: an adapter-injected `CLASSIFIER_MODEL_PORT` (tests, local adapters), else the Workers AI binding. */
export const classifierModel=config=>config?.CLASSIFIER_MODEL_PORT??workersAIClassifierModel(config?.AI);
/** Offered (manifest `contracts`, resource descriptor) only with a model port, a spend authority and a model version. */
export const classifierOffered=config=>classifierModel(config)?.configured===true&&typeof config?.SEMANTIC_SPEND?.authorityFor==='function'&&typeof config?.CLASSIFIER_MODEL_VERSION==='string'&&VERSION.test(config.CLASSIFIER_MODEL_VERSION);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),only=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const fail=(code,message,status=400,extra={})=>{throw Object.assign(new AppFault(code,message,status),extra);};
const enabled=(config,actor)=>{const flags=ownerFlags(config,actor?.owner,actor?.clientId);if(!flags.enabled('INTEGRATIONS_ENABLED')||!flags.enabled('EXTENSIONS_ENABLED'))fail('not_found','Not found.',404);};
const actorOwner=async(actor,store)=>{if(!['owner','system'].includes(actor?.kind)||!/^[a-f0-9-]{36}$/.test(actor.owner??''))fail('unauthorized','Sign in to continue.',401);if(await store.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);return actor.owner;};
/** Capabilities of the built-in (§4.2): the text media types its model port reads, inline only, within textBytes. */
export function classifierCapabilities(ai){
 const mediaTypes=(ai?.mediaTypes??[]).filter(t=>t.startsWith('text/'));
 return {kinds:ai?.configured===true&&mediaTypes.length?[{kind:'text',mediaTypes:[...mediaTypes],inputs:['inline'],maxBytes:CLASSIFIER_LIMITS.textBytes}]:[],maxLabels:CLASSIFIER_LIMITS.labels,model:{...ai?.model??{id:CLASSIFIER_MODEL,version:'unconfigured'}}};
}
/**
 * Deterministic validation of `classify` arguments before any effect: the contract (invalid_args, measured on the
 * contract arguments themselves, review M1) and then this resource's capabilities (unsupported_item). Returns the
 * validated copy with the decoded item in its non-enumerable `bytes`.
 */
export function classificationArgs(args,{now,ai}){
 let valid;try{valid=validateClassifyArgs(args,{now});refuseUnsupported(valid,validateCapabilities(classifierCapabilities(ai)));}
 catch(error){if(['invalid_args','unsupported_item'].includes(error?.code))fail(error.code,error.message);throw error;}
 return valid;
}
/** Wraps a model port with the paid gate, covered-work admission and the `classifier` spend ledger. */
export function classifierAI({binding,model=workersAIClassifierModel(binding),spend,plan,admitWork,version,clock=systemClock,timeoutMs=CLASSIFIER_LIMITS.timeoutMs}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>CLASSIFIER_LIMITS.timeoutMs)throw new TypeError('Invalid classifier timeout');
 const configured=model?.configured===true&&typeof model.prepare==='function'&&typeof model.run==='function'&&typeof model.scores==='function'&&typeof spend?.authorityFor==='function'&&typeof plan==='function'&&typeof admitWork==='function'&&typeof version==='string'&&VERSION.test(version);
 return Object.freeze({configured,model:Object.freeze({id:typeof model?.id==='string'?model.id:CLASSIFIER_MODEL,version:configured?version:'unconfigured'}),mediaTypes:Object.freeze([...(configured&&Array.isArray(model.mediaTypes)?model.mediaTypes:[])]),
  /** The owner's classifier plan (a CLASSIFIER_PLAN_LIMITS key) or null: the server-side paid gate. */
  plan:async owner=>{if(!configured)return null;const value=await plan(owner);return CLASSIFIER_PLANS.includes(value)?value:null;},
  // Work is charged to the consuming app's own client budget, never a shared bucket.
  admitWork:(owner,clientId)=>admitWork(owner,clientId),
  prepare:args=>model.prepare(args),
  // A nonrefundable lease on the sharded semantic authority's separate `ai` ledger (never its embedding tariff
  // or semantic owner admissions), sized from the prepared request, including malformed or unknown outcomes.
  async reserve(owner,microUSD){
   if(!configured)fail('temporarily_unavailable','Classifier is not configured.',503);
   if(!Number.isSafeInteger(microUSD)||microUSD<1||microUSD>CLASSIFIER_LIMITS.microUSD)fail('invalid_args','Classifier request exceeds its cost limit.');
   const expected=await semanticShard(owner,SEMANTIC_LAYOUT.budgetShards),{authority,partition}=await spend.authorityFor(owner);
   if(partition!==expected||typeof authority?.reserveLease!=='function')throw new SemanticBudgetError();
   // A refused lease (SemanticBudgetError) spent nothing; any other failure, or a grant that does not match the request,
   // may have spent money, so it is indeterminate.
   let grant;try{grant=await authority.reserveLease({owner,partition,microUSD,upsertSlots:0,ledger:'ai'});}catch(error){if(error instanceof SemanticBudgetError||error?.code==='semantic_global_budget')throw new SemanticBudgetError();fail('indeterminate','The classifier spend outcome is unknown.',503);}
   const day=new Date(clock.now()).toISOString().slice(0,10);
   if(grant?.owner!==owner||grant.partition!==partition||grant.layoutVersion!==SEMANTIC_LAYOUT.version||grant.day!==day||grant.month!==day.slice(0,7)||grant.microUSD!==microUSD||grant.upsertSlots!==0||grant.ledger!=='ai')fail('indeterminate','The classifier spend outcome is unknown.',503);
   return {microUSD};
  },
  async run(request){let timer,value;try{value=await Promise.race([Promise.resolve().then(()=>model.run(request)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Classifier timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}return value;},
  scores:(value,args)=>model.scores(value,args),
 });
}
const descriptorLimits=()=>({maxRequestBytes:32768,maxResultBytes:CLASSIFIER_LIMITS.responseBytes,txRetentionSeconds:86400});
export class ClassifierStatus extends AppQuery {
 static operation='classifier.status';static deps=['config','accountStore','ai'];
 async fetch({config,accountStore,ai}){enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore),plan=await ai.plan(owner);return {configured:ai.configured===true,offered:ai.configured===true,contract:CLASSIFIER_CONTRACT,model:{...ai.model},plan,limits:plan?{...CLASSIFIER_PLAN_LIMITS[plan]}:null,capabilities:classifierCapabilities(ai)};}
}
export class ClassifierDescriptors extends AppQuery {
 static operation='classifier.descriptors';static deps=['config','accountStore','ai'];
 async fetch({config,accountStore,ai}){
  enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore);if(ai.configured!==true)return [];
  // Review L3: an account without a classifier plan is not offered the built-in, so its owner cannot assign a classifier
  // that would only refuse (forbidden). An owner who assigned it and later lost the plan sees its items fail visibly in
  // the consuming app (Parlay: the failure tag, reason `unavailable`), never silently.
  if(!await ai.plan(owner))return [];
  return [{id:classifierResource(config,owner),label:CLASSIFIER_LABEL,provider:'bindle',contracts:{[CLASSIFIER_CONTRACT]:[...CLASSIFIER_METHODS]},generation:'v1',limits:descriptorLimits()}];
 }
}
// `capabilities` (a read, never charged): exact `{}` arguments; the paid gate applies, so a free account's apps learn
// only that the classifier is unavailable to them (forbidden), not its plan.
export class ClassifierCapabilities extends AppQuery {
 static operation='classifier.capabilities';static deps=['config','accountStore','ai'];
 async fetch({config,accountStore,ai}){
  enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore);
  try{validateCapabilitiesArgs(this.input??{});}catch(error){fail('invalid_args',error.message);}
  if(ai.configured!==true)fail('temporarily_unavailable','Classifier is not configured.',503);
  if(!await ai.plan(owner))fail('forbidden','Classification needs a current paid plan.',403);
  return classifierCapabilities(ai);
 }
}
// Reached only through a verified federation RPC on this built-in resource, which the app's grant must cover and the
// owner must have assigned in a field (protocol §4 intersection rule).
export class ClassifierClassify extends AppAction {
 static operation='classifier.classify';static deps=['config','accountStore','ai','clock'];
 async run({config,accountStore,ai,clock}){
  enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore),args=classificationArgs(this.input,{now:clock.now(),ai});
  if(ai.configured!==true)fail('temporarily_unavailable','Classifier is not configured.',503);
  const {request,microUSD}=ai.prepare(args),plan=await ai.plan(owner);
  if(!plan)fail('forbidden','Classification needs a current paid plan.',403);
  const debit={now:clock.now(),service:'classify',clientId:this.actor.clientId??'@owner',microUSD};
  await reserveAIAllowance(accountStore,{...debit,plan});
  // Review M1: the allowance debit stands only once work admission and the ledger lease are granted. A refusal between
  // the debit and the lease claims no effect, so it credits the debit back first.
  const refuse=async(...args)=>{await releaseAIAllowance(accountStore,debit);fail(...args);};
  let admitted;try{admitted=await ai.admitWork(owner,this.actor.clientId);}catch(error){await releaseAIAllowance(accountStore,debit);throw error;}
  if(admitted!==true)await refuse('rate_limited','Activity allowance is exhausted.',429);
  // First effect: the money lease. A refused lease spent nothing (rate_limited, so an app may fail over); from a granted
  // lease on, no refusal may claim that nothing happened, and the allowance stays charged.
  try{await ai.reserve(owner,microUSD);}catch(error){
   if(error instanceof SemanticBudgetError)await refuse('rate_limited','The classifier service budget is exhausted for now.',429,{retryAfter:retryAfter(clock.now(),'day')});
   if(error?.code==='invalid_args')await releaseAIAllowance(accountStore,debit);
   throw error;
  }
  return afterEffect(async()=>{
   if(!await ai.plan(owner))fail('forbidden','Classifier entitlement changed.',403);
   let value;try{value=await ai.run(request);}catch{fail('indeterminate','Classifier outcome is unknown; the allowance remains charged.',503);}
   if(!await ai.plan(owner))fail('forbidden','Classifier entitlement changed.',403);
   // Scores are advice for the caller's own thresholds; nothing here maps them to tags or actions.
   return {scores:ai.scores(value,args),model:{...ai.model}};
  });
 }
}
export const CLASSIFIER_OPERATIONS=Object.freeze([ClassifierStatus,ClassifierDescriptors,ClassifierCapabilities,ClassifierClassify]),CLASSIFIER_ENGINE_OPERATIONS=operations(...CLASSIFIER_OPERATIONS);
const planOf=async(c,id)=>{await c.billingRefresh(id);const value=(await c.billing.entitlement(id)).plan;return CLASSIFIER_PLANS.includes(value)?value:null;};
// Runtime composition uses the read-only X4 system port. The model port, paid check and work admission are effects.
function runtimeEngine(c,owner){return createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:c.config,accountStore:c.metadata,
 ai:classifierAI({model:classifierModel(c.config),spend:c.config.SEMANTIC_SPEND,version:c.config.CLASSIFIER_MODEL_VERSION,plan:id=>planOf(c,id),admitWork:(id,clientId)=>c.admitWork(id,{clientId:typeof clientId==='string'&&clientId?clientId:'@classifier'})})}});}
// Contract adapter: context comes only from verified federation RPC, never from content or consumer parameters. The
// federation dispatcher keeps `classify` results out of its journal (packages/runtime/federation.mjs) and treats
// `capabilities` as a read.
export async function classifierResourceMethod(c,owner,context){
 enabled(c.config,{owner,clientId:context?.clientId});if(!CLASSIFIER_METHODS.includes(context?.method))fail('unsupported_method','Unsupported classifier method.');
 if(context.authority!=='bindle'||context.contract!==CLASSIFIER_CONTRACT||context.subject!==`${c.config.APP_ORIGIN}/entities/${owner}`||!context.connection||!context.epoch||typeof context.clientId!=='string')fail('forbidden','Classifier access denied.',403);
 await c.warm(owner);
 if(typeof c.config.FEDERATION_IDENTITY_CHECK!=='function'||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)fail('unauthorized','Application authorization is no longer active.',401);
 await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);
 if(context.resource!==classifierResource(c.config,owner)||context.resourceGeneration!=='v1')fail('forbidden','Classifier resource changed.',403);
 const engine=runtimeEngine(c,owner),actor={kind:'system',owner,clientId:context.clientId};
 try{
  if(context.method==='capabilities')return await read(engine,new ClassifierCapabilities({actor,input:context.args}));
  // After the model call a lost authorization is reported as indeterminate (review M2): the item was already disclosed.
  const result=await perform(engine,new ClassifierClassify({actor,input:context.args}));
  // Any authorization failure here (401 included, which extensions §3.3 would read as no-effect) is indeterminate.
  try{if(await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)throw new Error('identity');await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);}catch{fail('indeterminate','The classification outcome is unknown: authorization changed during the call.',503);}
  return result;
 }finally{await engine.dispose();}
}

export const methods={
 async classifierDescriptors(owner){
  if(!ownerFlags(this.config,owner).enabled('INTEGRATIONS_ENABLED')||!ownerFlags(this.config,owner).enabled('EXTENSIONS_ENABLED'))return [];
  const engine=runtimeEngine(this,owner);try{return await read(engine,new ClassifierDescriptors({actor:{kind:'system',owner}}));}finally{await engine.dispose();}
 },
};
export const rpc={classifierDescriptors:{warm:true}};
