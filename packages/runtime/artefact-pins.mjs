import sendMessageIntent from '../../docs/artefacts/intents/send-message-v1.json' with {type:'json'};
import addContactIntent from '../../docs/artefacts/intents/add-contact-v1.json' with {type:'json'};
import openConversationIntent from '../../docs/artefacts/intents/open-conversation-v1.json' with {type:'json'};
import {validateIntentKind} from '../intents/schema.mjs';
import {contractMethods} from '../core/contract-methods.mjs';
import preferencesV2 from '../../docs/artefacts/preferences-v2.json' with {type:'json'};
import rtcSignalingV1 from '../../docs/artefacts/rtc-signaling-v1.json' with {type:'json'};
import {createAppEngine,read} from '../app/engine.mjs';
import {IntegrationContract,createIntegrationsProvider} from '../federation/integrations.mjs';
import {CONSENT_CONTRACT_SCHEMAS} from '../consent/contracts.mjs';
// ART-4 adapter composition. Only operator-reviewed documents; never ambient network access.
import {artefactRuntime} from './artefacts.mjs';
import {federationSchemas} from './federation.mjs';
import {GOOGLE_DRIVE_SETUP_FRAGMENT} from '../storage/google-drive-integration.mjs';
import {flagsFor,siteGlobal} from '../flags/read.mjs';
import {systemClock,cryptoRandom,nullAudit} from '../app/providers.mjs';
import {validateSchema,fail} from '../federation/schema.mjs';
import {validateBusManifest} from '../federation/event-buses.mjs';
// RTC-b: reviewed rtc-purpose lines, registered like intent kinds (spec rtc-signaling §3.4; the kind stays out of DEFAULT_KINDS).
import {REGISTERED_PURPOSES,RTC_PURPOSE_KIND,validatePurpose} from '../rtc/purposes.mjs';
export const ARTEFACT_STORE='bindle-artefacts-v1';
export function configuredArtefacts({config,store,clock=systemClock}){
 const documents=new Proxy({}, {get:(_,key)=>configuredArtefactDocuments(config)[key],getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(configuredArtefactDocuments(config),key)?{configurable:true,enumerable:true,value:configuredArtefactDocuments(config)[key]}:undefined});
 const runtime=artefactRuntime({store,documents,flags:{for:ctx=>flagsFor(config,ctx)},clock,random:cryptoRandom,audit:nullAudit,validateBody:(body,{id,kind})=>{
  if(kind==='intent')return validateIntentKind(body).id===id;
  if(kind===RTC_PURPOSE_KIND){try{return validatePurpose(body).id===id;}catch{return false;}}
  if(kind==='bus')return validateBusManifest(body,id).status==='valid';
  if(kind==='rpc-contract')return body?.$id===id&&Object.keys(contractMethods(body)).length>0;
  if(kind===undefined||kind==='fragment'){validateSchema(body,id);return true;}return false;
 }});
 return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},...runtime};
}
export function reviewedSchemaFetcher(config,missing='untrusted_schema_host'){
 const fetcher=async url=>{const schemas=federationSchemas(config);if(!Object.hasOwn(schemas,url))fail(missing,missing==='unsupported_fragment'?'Unsupported fragment.':'This fragment has not been registered with this provider.');return structuredClone(schemas[url]);};
 Object.defineProperty(fetcher,'artefacts',{get:()=>config.ARTEFACTS});return fetcher;
}
// The registry check is local (operator configuration), so an unregistered id never reaches the provider-wide store.
export const registeredArtefact=(config,id)=>{if(typeof id!=='string')return false;const documents=configuredArtefactDocuments(config);return Object.hasOwn(documents,id)||Object.hasOwn(documents,id+'/envelope');};
export function remoteArtefacts(config,invoke){return {get enabled(){return siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED');},registered:id=>registeredArtefact(config,id),...Object.fromEntries(['pin','resolve','refresh','record'].map(method=>[method,async input=>{const response=await invoke(method,input);if(!response.ok)throw Object.assign(new Error(response.error.code),response.error);return response.result;}]))};}

// Operator-reviewed contracts share the durable resolver; no URL from an app becomes an ambient fetch.
const documentRevisions=new WeakMap(),frozenCopies=new WeakMap();
function deepFreeze(value){if(value&&typeof value==='object'&&!ArrayBuffer.isView(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}
// Callers never receive a live operator (or module) object: each distinct value is copied and frozen once.
const detached=value=>{if(!value||typeof value!=='object')return value;if(ArrayBuffer.isView(value))return value.slice();let copy=frozenCopies.get(value);if(!copy)frozenCopies.set(value,copy=deepFreeze(structuredClone(value)));return copy;};
// federationSchemas' 100-entry bound, re-checked against a live object registry on every lookup.
function boundedSchemas(config){const live=config.FEDERATION_SCHEMAS;if(live&&typeof live==='object'&&Object.keys(live).length+(siteGlobal(config,'INTEGRATIONS_ENABLED')&&!Object.hasOwn(live,GOOGLE_DRIVE_SETUP_FRAGMENT.id)?1:0)>100)throw new TypeError('Invalid reviewed fragment registry.');}
export function configuredArtefactDocuments(config){
 const revision=[config.FEDERATION_CONTRACTS,config.FEDERATION_SCHEMAS,siteGlobal(config,'INTEGRATIONS_ENABLED'),siteGlobal(config,'EXTENSIONS_ENABLED'),siteGlobal(config,'RTC_SIGNALING_ENABLED'),siteGlobal(config,'INTENT_LINKS_ENABLED')],cached=documentRevisions.get(config);
 if(cached&&revision.every((value,i)=>value===cached.revision[i])){boundedSchemas(config);return cached.documents;}
 const contracts=typeof config.FEDERATION_CONTRACTS==='string'?JSON.parse(config.FEDERATION_CONTRACTS):config.FEDERATION_CONTRACTS??{},documents={};
 // RTC-i: the rtc-signaling/v1 contract (spec §9.1) is a first-party reviewed document while the provider implements
 // the signaling fragment (RTC_SIGNALING_ENABLED and EXTENSIONS_ENABLED). Review L3: it WINS over an operator registration
 // of the same id, for both the plain id and its `/envelope` (one source, ahead of every other), exactly as the
 // built-in signaling fragment replaces an operator fragment (packages/runtime/federation.mjs federationSchemas). An
 // operator that registered only one of the two keys can therefore never get the operator body under one key and the
 // shipped body under the other. With either flag off nothing is added and operator registrations apply as before.
 const firstParty={},envelopeOf=body=>({bindle_artefact:1,id:body.$id,kind:'rpc-contract',versions:[{version:1,prev:null,body}]});
 if(siteGlobal(config,'RTC_SIGNALING_ENABLED')&&siteGlobal(config,'EXTENSIONS_ENABLED')){firstParty[rtcSignalingV1.$id]=rtcSignalingV1;firstParty[rtcSignalingV1.$id+'/envelope']=envelopeOf(rtcSignalingV1);}
 for(const body of [...CONSENT_CONTRACT_SCHEMAS,preferencesV2]){documents[body.$id]=body;documents[body.$id+'/envelope']=envelopeOf(body);}
 // The messaging intent kinds serve only the intent router (INTENT_LINKS_ENABLED) and the rtc-purpose lines only RTC
 // signaling (RTC_SIGNALING_ENABLED), so a default deployment registers none of them (cleanup audit 2026-10-27). They
 // are slated for removal (core hard-codes no kinds; signaling App. C); until then they register only behind those flags.
 const builtIns=[...siteGlobal(config,'INTENT_LINKS_ENABLED')?[sendMessageIntent,addContactIntent,openConversationIntent]:[],...siteGlobal(config,'RTC_SIGNALING_ENABLED')?REGISTERED_PURPOSES:[]];
 for(const envelope of builtIns){documents[envelope.id]=envelope;documents[envelope.id+'/envelope']=envelope;}
 const schemas=federationSchemas(config),liveSchemas=config.FEDERATION_SCHEMAS&&typeof config.FEDERATION_SCHEMAS==='object'?config.FEDERATION_SCHEMAS:null;
 if(liveSchemas){const builtins=federationSchemas({...config,FEDERATION_SCHEMAS:{}});for(const key of Object.keys(schemas))delete schemas[key];Object.assign(schemas,builtins);}
 const sources=[firstParty,schemas,...liveSchemas?[liveSchemas]:[],contracts,documents];
 // Object registries remain live for local operator updates; replacing a registry (or its JSON
 // bytes / relevant flags) creates a new normalized revision. No per-property flattening.
 const owner=key=>{boundedSchemas(config);return sources.find(source=>Object.hasOwn(source,key));};
 const normalized=new Proxy({}, {get:(_,key)=>{const source=owner(key);return source?detached(source[key]):undefined;},getOwnPropertyDescriptor:(_,key)=>{const source=owner(key);return source?{configurable:true,enumerable:true,value:detached(source[key])}:undefined;},ownKeys:()=>{boundedSchemas(config);return [...new Set(sources.flatMap(source=>Reflect.ownKeys(source)))];}});
 documentRevisions.set(config,{revision,documents:normalized});return normalized;
}
export async function pinConfiguredContract(config,target){
 if(!siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED')||!config.ARTEFACTS?.enabled)fail('unsupported_artefact_version');
 const {contract,version,digest}=typeof target==='string'?{contract:target}:target;
 const pin=await config.ARTEFACTS.pin({artefact:contract,kind:'rpc-contract',...version!==undefined?{version}:{},...digest!==undefined?{digest}:{}});
 if(!pin.reference.version||pin.body?.$id!==contract)fail('artefact_unverifiable');return {schema:pin.body,version:pin.reference.version,digest:pin.reference.digest};
}
export async function resolveConfiguredContract(config,{contract,version,digest}){const pin=await config.ARTEFACTS.resolve({artefact:contract,kind:'rpc-contract',version,digest});return {digest:pin.reference.digest,record:await config.ARTEFACTS.record(pin.reference.digest)};}

export async function configuredContractVersion(config,input){
 const enabled=siteGlobal(config,'ARTEFACT_VERSIONS_ENABLED')||input.existing===true;const engine=createAppEngine({providers:{clock:systemClock,random:cryptoRandom,audit:nullAudit,config:{INTEGRATIONS_ENABLED:'true',ARTEFACT_VERSIONS_ENABLED:enabled?'true':'false'},integrations:createIntegrationsProvider({artefactVersions:enabled,contractResolver:target=>resolveConfiguredContract(config,target)})}});
 try{return await read(engine,new IntegrationContract({input}));}finally{await engine.dispose();}
}
