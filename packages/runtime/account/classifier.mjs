import {ownerFlags} from './flags.mjs';
// Extensions CR-X3-25 (provisional, unsigned): the classifier is a paid built-in resource in the owner's pool that
// implements the Bindle item-classification/v1 contract (docs/spec/extensions/item-classification.md), listed in the
// provider manifest's `contracts` (extensions §5.2) while it is offered. The caller supplies the taxonomy with every call;
// this provider hard-codes no categories. Apps consume it through an ordinary grant on the Bindle item-classification
// fragment (`selection: ordered`, `consumers: [application]`), whose value only the owner sets. No slot, automatic
// assignment, threshold or model fallback. The former 3sln.me item-classifier fragment and decision-model/v1 contract
// (with eleven message categories fixed here) are withdrawn; message categories belong to Parlay.
import fragment from '../../../docs/artefacts/fragments/item-classification-v1.json' with {type:'json'};
import contract from '../../../docs/artefacts/item-classification-v1.json' with {type:'json'};
import {AppAction,AppQuery,createAppEngine,perform,read,operations} from '../../app/engine.mjs';
import {AppFault} from '../../app/faults.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../../app/providers.mjs';
import {SemanticBudgetError} from '../semantic-budget.mjs';
import {SEMANTIC_LAYOUT,semanticShard} from '../semantic-routing.mjs';
import {CLASSIFIER_LIMITS,CLASSIFIER_MODEL,CLASSIFIER_COST,classifierCostMicroUSD,workersAIClassifierModel} from './classifier-models.mjs';
export {CLASSIFIER_LIMITS,CLASSIFIER_MODEL,CLASSIFIER_COST,classifierCostMicroUSD};

const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const CLASSIFIER_FRAGMENT_DOCUMENT=freeze(structuredClone(fragment)),CLASSIFIER_FRAGMENT=fragment.id,CLASSIFIER_CONTRACT_DOCUMENT=freeze(structuredClone(contract)),CLASSIFIER_CONTRACT=contract.$id;
export const CLASSIFIER_METHOD='classify',CLASSIFIER_LABEL='3sln.me classifier';
/** The built-in classifier resource of `owner` (one per account, stable). */
export const classifierResource=(config,owner)=>`${config.APP_ORIGIN}/entities/${owner}/classifier`;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** The model port: an adapter-injected `CLASSIFIER_MODEL_PORT` (tests, local adapters), else the Workers AI binding. */
export const classifierModel=config=>config?.CLASSIFIER_MODEL_PORT??workersAIClassifierModel(config?.AI);
/** Offered (manifest `contracts`, resource descriptor) only with a model port, a spend authority and a model version. */
export const classifierOffered=config=>classifierModel(config)?.configured===true&&typeof config?.SEMANTIC_SPEND?.authorityFor==='function'&&typeof config?.CLASSIFIER_MODEL_VERSION==='string'&&VERSION.test(config.CLASSIFIER_MODEL_VERSION);
const USAGE='classifier/usage/v1';
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),only=(v,keys)=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const bytes=v=>new TextEncoder().encode(v).length;
const fail=(code,message,status=400)=>{throw new AppFault(code,message,status);};
const enabled=(config,actor)=>{const flags=ownerFlags(config,actor?.owner,actor?.clientId);if(!flags.enabled('INTEGRATIONS_ENABLED')||!flags.enabled('EXTENSIONS_ENABLED'))fail('not_found','Not found.',404);};
const actorOwner=async(actor,store)=>{if(!['owner','system'].includes(actor?.kind)||!/^[a-f0-9-]{36}$/.test(actor.owner??''))fail('unauthorized','Sign in to continue.',401);if(await store.get('owner')!==actor.owner)fail('forbidden','Account owner mismatch.',403);return actor.owner;};
const TOKEN=/^[a-z0-9][a-z0-9._-]{0,63}$/,MEDIA_TYPE=/^[a-z]{1,20}\/[a-z0-9][a-z0-9.+-]{0,99}$/,BASE64URL=/^[A-Za-z0-9_-]*$/;
// C0, DEL, C1, line/paragraph separators and bidirectional controls: a label description is one plain line.
const CONTROL=/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const invalid=message=>fail('invalid_args',message);
/**
 * Deterministic validation of item-classification/v1 `classify` arguments (spec §3), in a fixed order, before any
 * entitlement, allowance, spend or model call: the contract bounds, then this resource's smaller limits, then media
 * support. Returns a fresh copy holding only validated members.
 */
export function classificationArgs(args,{mediaTypes=[]}={}){
 if(!only(args,['item','labels'])||!plain(args.item)||!Array.isArray(args.labels))invalid('Use an item and a list of labels.');
 const {item,labels}=args;
 if(!only(item,['text','hints','media'])||item.text===undefined&&item.media===undefined)invalid('An item needs text or media.');
 if(item.text!==undefined&&(typeof item.text!=='string'||item.text.length>4096||!item.text.isWellFormed()))invalid('Item text must be well-formed and at most 4,096 characters.');
 if(item.hints!==undefined&&(!Array.isArray(item.hints)||item.hints.length>16||item.hints.some(h=>typeof h!=='string'||!TOKEN.test(h))||new Set(item.hints).size!==item.hints.length))invalid('Use at most 16 distinct lowercase hint tokens.');
 if(item.media!==undefined&&(!only(item.media,['type','data'])||typeof item.media.type!=='string'||!MEDIA_TYPE.test(item.media.type)||typeof item.media.data!=='string'||item.media.data.length>349526||!BASE64URL.test(item.media.data)||item.media.data.length%4===1))invalid('Media needs a media type and unpadded base64url data of at most 256 KiB.');
 if(labels.length<1||labels.length>16)invalid('Use 1 to 16 labels.');
 for(const label of labels)if(!only(label,['id','description'])||typeof label.id!=='string'||!TOKEN.test(label.id)||typeof label.description!=='string'||label.description.length<1||label.description.length>200||!label.description.isWellFormed()||CONTROL.test(label.description)||!label.description.trim())invalid('Each label needs a lowercase id and a one-line description of at most 200 characters.');
 if(new Set(labels.map(l=>l.id)).size!==labels.length)invalid('Label ids must be distinct.');
 // This resource's limits (advertised in its descriptor): smaller than the contract's, refused the same way.
 if(item.text!==undefined&&bytes(item.text)>CLASSIFIER_LIMITS.textBytes)invalid(`Item text exceeds this classifier's ${CLASSIFIER_LIMITS.textBytes}-byte limit.`);
 if(labels.length>CLASSIFIER_LIMITS.labels)invalid('Too many labels for this classifier.');
 if(item.media!==undefined&&!mediaTypes.includes(item.media.type))fail('unsupported_media_type','This classifier does not accept that media type.');
 return {item:{...item.text!==undefined?{text:item.text}:{},hints:[...item.hints??[]],...item.media!==undefined?{media:{type:item.media.type,data:item.media.data}}:{}},labels:labels.map(({id,description})=>({id,description}))};
}
/** Wraps a model port with the owner's paid entitlement, covered-work admission and the `classifier` spend ledger. */
export function classifierAI({binding,model=workersAIClassifierModel(binding),spend,eligible,admitWork,version,clock=systemClock,timeoutMs=CLASSIFIER_LIMITS.timeoutMs}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>CLASSIFIER_LIMITS.timeoutMs)throw new TypeError('Invalid classifier timeout');
 const configured=model?.configured===true&&typeof model.prepare==='function'&&typeof model.run==='function'&&typeof model.scores==='function'&&typeof spend?.authorityFor==='function'&&typeof eligible==='function'&&typeof admitWork==='function'&&typeof version==='string'&&VERSION.test(version);
 return Object.freeze({configured,model:Object.freeze({id:typeof model?.id==='string'?model.id:CLASSIFIER_MODEL,version:configured?version:'unconfigured'}),mediaTypes:Object.freeze([...(configured&&Array.isArray(model.mediaTypes)?model.mediaTypes:[])]),
  eligible:owner=>configured?eligible(owner):false,
  // Work is charged to the consuming app (its own client budget), not a shared '@classifier' bucket.
  admitWork:(owner,clientId)=>admitWork(owner,clientId),
  prepare:args=>model.prepare(args),
  // A nonrefundable lease on the sharded semantic authority's separate `classifier` ledger (never its embedding tariff
  // or semantic owner admissions), sized from the prepared request, including malformed or unknown outcomes.
  async reserve(owner,microUSD){
   if(!configured)fail('temporarily_unavailable','Classifier is not configured.',503);
   if(!Number.isSafeInteger(microUSD)||microUSD<1||microUSD>CLASSIFIER_LIMITS.microUSD)fail('invalid_args','Classifier request exceeds its cost limit.');
   const expected=await semanticShard(owner,SEMANTIC_LAYOUT.budgetShards),{authority,partition}=await spend.authorityFor(owner);
   if(partition!==expected||typeof authority?.reserveLease!=='function')throw new SemanticBudgetError();
   const grant=await authority.reserveLease({owner,partition,microUSD,upsertSlots:0,ledger:'classifier'}),day=new Date(clock.now()).toISOString().slice(0,10);
   if(grant?.owner!==owner||grant.partition!==partition||grant.layoutVersion!==SEMANTIC_LAYOUT.version||grant.day!==day||grant.month!==day.slice(0,7)||grant.microUSD!==microUSD||grant.upsertSlots!==0||grant.ledger!=='classifier')throw new SemanticBudgetError();
   return {microUSD};
  },
  async run(request,args){let timer,value;try{value=await Promise.race([Promise.resolve().then(()=>model.run(request)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Classifier timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}return value;},
  scores:(value,args)=>model.scores(value,args),
 });
}
async function reserveAccount(store,clock){
 const day=new Date(clock.now()).toISOString().slice(0,10),month=day.slice(0,7);
 await store.transaction(async tx=>{const prior=await tx.get(USAGE);if(prior!==undefined&&(!only(prior,['day','month','dailyCalls','monthlyCalls'])||typeof prior.day!=='string'||typeof prior.month!=='string'||!Number.isSafeInteger(prior.dailyCalls)||prior.dailyCalls<0||!Number.isSafeInteger(prior.monthlyCalls)||prior.monthlyCalls<0))fail('classifier_account_budget','Classifier allowance is unavailable.',429);
  const dailyCalls=(prior?.day===day?prior.dailyCalls:0)+1,monthlyCalls=(prior?.month===month?prior.monthlyCalls:0)+1;
  if(dailyCalls>CLASSIFIER_LIMITS.dailyCalls||monthlyCalls>CLASSIFIER_LIMITS.monthlyCalls)fail('classifier_account_budget','Classifier allowance is exhausted.',429);
  // Counters only: the item, its labels and the scores are never written anywhere (spec §5).
  await tx.put(USAGE,{day,month,dailyCalls,monthlyCalls});
 });
}
const descriptorLimits=ai=>({maxRequestBytes:CLASSIFIER_LIMITS.requestBytes,maxResultBytes:CLASSIFIER_LIMITS.responseBytes,txRetentionSeconds:86400,maxTextBytes:CLASSIFIER_LIMITS.textBytes,maxLabels:CLASSIFIER_LIMITS.labels,mediaTypes:[...ai.mediaTypes]});
export class ClassifierStatus extends AppQuery {
 static operation='classifier.status';static deps=['config','accountStore','ai'];
 async fetch({config,accountStore,ai}){enabled(config,this.actor);await actorOwner(this.actor,accountStore);return {configured:ai.configured===true,offered:ai.configured===true,contract:CLASSIFIER_CONTRACT,model:{...ai.model},limits:{...CLASSIFIER_LIMITS,mediaTypes:[...ai.mediaTypes]}};}
}
export class ClassifierDescriptors extends AppQuery {
 static operation='classifier.descriptors';static deps=['config','accountStore','ai'];
 async fetch({config,accountStore,ai}){
  enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore);if(ai.configured!==true)return [];
  return [{id:classifierResource(config,owner),label:CLASSIFIER_LABEL,provider:'bindle',contracts:{[CLASSIFIER_CONTRACT]:[CLASSIFIER_METHOD]},generation:'v1',limits:descriptorLimits(ai)}];
 }
}
// Reached only through a verified federation RPC on this built-in resource, which the app's grant must cover and the
// owner must have assigned in the field (protocol §4 intersection rule). Order: validate (no effect), configuration,
// entitlement, covered work, account allowance, spend lease, model; entitlement is rechecked around the model call.
export class ClassifierClassify extends AppAction {
 static operation='classifier.classify';static deps=['config','accountStore','ai','clock'];
 async run({config,accountStore,ai,clock}){
  enabled(config,this.actor);const owner=await actorOwner(this.actor,accountStore),args=classificationArgs(this.input,{mediaTypes:ai.mediaTypes??[]});
  if(ai.configured!==true)fail('temporarily_unavailable','Classifier is not configured.',503);
  const {request,microUSD}=ai.prepare(args);
  if(await ai.eligible(owner)!==true)fail('forbidden','Classification needs a current paid entitlement.',403);
  if(await ai.admitWork(owner,this.actor.clientId)!==true)fail('rate_limited','Activity allowance is exhausted.',429);
  await reserveAccount(accountStore,clock);await ai.reserve(owner,microUSD);
  if(await ai.eligible(owner)!==true)fail('forbidden','Classifier consent changed.',403);
  let value;try{value=await ai.run(request,args);}catch{fail('indeterminate','Classifier outcome is unknown; allowance remains charged.',503);}
  if(await ai.eligible(owner)!==true)fail('forbidden','Classifier consent changed.',403);
  // Scores are advice for the caller's own thresholds; nothing here maps them to tags or actions.
  return {scores:ai.scores(value,args),model:{...ai.model}};
 }
}
export const CLASSIFIER_OPERATIONS=Object.freeze([ClassifierStatus,ClassifierDescriptors,ClassifierClassify]),CLASSIFIER_ENGINE_OPERATIONS=operations(...CLASSIFIER_OPERATIONS);
// Runtime composition uses the read-only X4 system port. The model port, paid check and work admission are effects.
function runtimeEngine(c,owner){return createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:c.config,accountStore:c.metadata,
 ai:classifierAI({model:classifierModel(c.config),spend:c.config.SEMANTIC_SPEND,version:c.config.CLASSIFIER_MODEL_VERSION,eligible:async id=>{await c.billingRefresh(id);return ['paid','plus','ultra'].includes((await c.billing.entitlement(id)).plan);},admitWork:(id,clientId)=>c.admitWork(id,{clientId:typeof clientId==='string'&&clientId?clientId:'@classifier'})})}});}
// Contract adapter: context comes only from verified federation RPC, never from content or consumer parameters. The
// federation dispatcher keeps this contract's results out of its journal (packages/runtime/federation.mjs).
export async function classifierResourceMethod(c,owner,context){
 enabled(c.config,{owner,clientId:context?.clientId});if(context?.method!==CLASSIFIER_METHOD)fail('unsupported_method','Unsupported classifier method.');
 if(context.authority!=='bindle'||context.contract!==CLASSIFIER_CONTRACT||context.subject!==`${c.config.APP_ORIGIN}/entities/${owner}`||!context.connection||!context.epoch||typeof context.clientId!=='string')fail('forbidden','Classifier access denied.',403);
 await c.warm(owner);
 if(typeof c.config.FEDERATION_IDENTITY_CHECK!=='function'||await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)fail('unauthorized','Application authorization is no longer active.',401);
 await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);
 if(context.resource!==classifierResource(c.config,owner)||context.resourceGeneration!=='v1')fail('forbidden','Classifier resource changed.',403);
 const engine=runtimeEngine(c,owner);try{const result=await perform(engine,new ClassifierClassify({actor:{kind:'system',owner,clientId:context.clientId},input:context.args}));if(await c.config.FEDERATION_IDENTITY_CHECK(owner,context.epoch)!==true)fail('unauthorized','Application authorization is no longer active.',401);await c.apps.check(owner,context.connection.id,context.connection.generation,context.clientId);return result;}finally{await engine.dispose();}
}

export const methods={
 async classifierDescriptors(owner){
  if(!ownerFlags(this.config,owner).enabled('INTEGRATIONS_ENABLED')||!ownerFlags(this.config,owner).enabled('EXTENSIONS_ENABLED'))return [];
  const engine=runtimeEngine(this,owner);try{return await read(engine,new ClassifierDescriptors({actor:{kind:'system',owner}}));}finally{await engine.dispose();}
 },
};
export const rpc={classifierDescriptors:{warm:true}};
